import copy
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('verify_release', Path(__file__).with_name('verify-release.py'))
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)


class PublicCertificateCommandTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == 'darwin', 'macOS codesign integration')
    def test_extract_public_certificate_uses_output_prefix(self):
        with tempfile.TemporaryDirectory() as directory:
            # Exercise actual codesign parsing without reading a keychain or key.
            prefix = str(Path(directory) / 'signing-cert-')
            # Some macOS system signatures omit their embedded certificate chain.
            # Successful codesign parsing is still testable without a private key.
            v.run('codesign', '-d', '--extract-certificates=' + prefix, '/usr/bin/true')
            certificate = Path(prefix + '0')
            if certificate.exists():
                first = certificate.read_bytes()
                self.assertGreater(len(first), 100)
                self.assertEqual(v.signing_certificate('/usr/bin/true', directory), first)
            else:
                with self.assertRaisesRegex(ValueError, 'no embedded public signing certificate'):
                    v.signing_certificate('/usr/bin/true', directory)


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.p = copy.deepcopy(v.POLICY)
        self.cert = b'synthetic public certificate, not a credential'
        self.p['certificateSha256'] = hashlib.sha256(self.cert).hexdigest()
        self.now = dt.datetime(2026, 10, 3, tzinfo=dt.timezone.utc)

    def profile(self, target):
        t = self.p['profiles'][target]
        e = {'application-identifier': self.p['teamId'] + '.' + t['bundleId'],
             'com.apple.developer.team-identifier': self.p['teamId'], 'get-task-allow': False,
             'beta-reports-active': True, 'com.apple.security.application-groups': t['groups'],
             'com.apple.developer.applesignin': t['appleSignin']}
        if t['push']:
            e['aps-environment'] = t['push']
        if t.get('associatedDomains'):
            e['com.apple.developer.associated-domains'] = ['*']
        return dict(UUID=t['uuid'], Name=t['name'], TeamIdentifier=[self.p['teamId']],
                    ApplicationIdentifierPrefix=[self.p['teamId']], Platform=['iOS'],
                    CreationDate=dt.datetime(2026, 9, 1), ExpirationDate=dt.datetime(2027, 5, 12),
                    DeveloperCertificates=[self.cert], Entitlements=e)

    def verify(self, profile, name='app'):
        v.verify_profile(profile, self.p['profiles'][name], self.cert, self.now, self.p)

    def test_all_approved_profiles(self):
        for target in self.p['profiles']:
            self.verify(self.profile(target), target)

    def test_profile_failures(self):
        for key, value in [('UUID', 'other'), ('Name', 'new'), ('TeamIdentifier', ['other']),
                           ('ApplicationIdentifierPrefix', ['other']), ('Platform', ['macOS']),
                           ('ProvisionedDevices', []), ('ProvisionsAllDevices', True),
                           ('ExpirationDate', dt.datetime(2026, 10, 3, 0, 30)),
                           ('CreationDate', dt.datetime(2030, 1, 1)),
                           ('DeveloperCertificates', [b'different'])]:
            with self.subTest(key=key):
                p = self.profile('app'); p[key] = value
                with self.assertRaises(ValueError): self.verify(p)

    def test_entitlement_failures(self):
        for key, value in [('application-identifier', 'wrong'), ('get-task-allow', True),
                           ('beta-reports-active', False), ('com.apple.security.application-groups', ['other']),
                           ('com.apple.developer.applesignin', ['other']), ('aps-environment', 'development')]:
            with self.subTest(key=key):
                p = self.profile('app'); p['Entitlements'][key] = value
                with self.assertRaises(ValueError): self.verify(p)

    def test_profile_install_preserves_existing_bytes(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root); src = root/'source'; src.mkdir(); dest = root/'cache'; dest.mkdir()
            for name in self.p['profiles']: (src/(name+'.mobileprovision')).write_bytes(name.encode())
            target = self.p['profiles']['app']; existing = dest/(target['uuid']+'.mobileprovision')
            existing.write_bytes(b'existing cached bytes')
            with patch.object(v, 'decode', lambda path: self.profile(path.stem)):
                with self.assertRaises(ValueError): v.install_profiles(src, self.cert, dest, self.p)
            self.assertEqual(existing.read_bytes(), b'existing cached bytes')
            self.assertEqual(len(list(dest.iterdir())), 1)

    def test_profile_install_reuses_identical_cache(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root); src = root/'source'; src.mkdir(); dest = root/'cache'
            for name in self.p['profiles']: (src/(name+'.mobileprovision')).write_bytes(name.encode())
            with patch.object(v, 'decode', lambda path: self.profile(path.stem)):
                v.install_profiles(src, self.cert, dest, self.p)
                mtimes = {p.name:p.stat().st_mtime_ns for p in dest.iterdir()}
                v.install_profiles(src, self.cert, dest, self.p)
            self.assertEqual(mtimes, {p.name:p.stat().st_mtime_ns for p in dest.iterdir()})


class MacReleaseTests(unittest.TestCase):
    def setUp(self):
        self.p = copy.deepcopy(v.POLICY)
        self.cert = b'synthetic public certificate, not a credential'
        self.p['certificateSha256'] = hashlib.sha256(self.cert).hexdigest()
        self.now = dt.datetime(2026, 11, 4, tzinfo=dt.timezone.utc)

    def profile(self):
        t = self.p['macProfiles']['app']
        # Mirrors the decoded pinned Mac Catalyst App Store profile: OSX, no beta-reports-active.
        e = {'application-identifier': self.p['teamId'] + '.' + t['bundleId'],
             'com.apple.developer.team-identifier': self.p['teamId'], 'get-task-allow': False,
             'com.apple.security.application-groups': t['groups'], 'com.apple.developer.applesignin': t['appleSignin'],
             'aps-environment': t['push'], 'com.apple.developer.aps-environment': t['push']}
        return dict(UUID=t['uuid'], Name=t['name'], TeamIdentifier=[self.p['teamId']], ApplicationIdentifierPrefix=[self.p['teamId']],
                    Platform=['OSX'], CreationDate=dt.datetime(2026, 9, 8), ExpirationDate=dt.datetime(2027, 5, 12),
                    DeveloperCertificates=[self.cert], Entitlements=e)

    def test_pinned_mac_profile_verifies_only_as_mac(self):
        target = self.p['macProfiles']['app']
        v.verify_profile(self.profile(), target, self.cert, self.now, self.p, platform='mac')
        with self.assertRaises(ValueError):
            v.verify_profile(self.profile(), target, self.cert, self.now, self.p, platform='ios')
        for key, value in [('Platform', ['iOS']), ('UUID', 'other'), ('DeveloperCertificates', [b'other']), ('ProvisionsAllDevices', True)]:
            with self.subTest(key=key):
                profile = self.profile(); profile[key] = value
                with self.assertRaises(ValueError): v.verify_profile(profile, target, self.cert, self.now, self.p, platform='mac')
        for key, value in [('aps-environment', 'development'), ('get-task-allow', True), ('com.apple.security.application-groups', [])]:
            with self.subTest(entitlement=key):
                profile = self.profile(); profile['Entitlements'][key] = value
                with self.assertRaises(ValueError): v.verify_profile(profile, target, self.cert, self.now, self.p, platform='mac')

    def signed(self):
        # Exactly what a local Mac Catalyst archive with the pinned profile is signed with.
        return {'com.apple.security.network.client': True, 'get-task-allow': False, 'com.apple.developer.applesignin': ['Default'],
                'com.apple.developer.team-identifier': 'V6JPQCD336', 'com.apple.security.app-sandbox': True,
                'application-identifier': 'V6JPQCD336.com.jimgreco.commonweek', 'com.apple.developer.aps-environment': 'production',
                'com.apple.security.personal-information.calendars': True, 'com.apple.application-identifier': 'V6JPQCD336.com.jimgreco.commonweek',
                'aps-environment': 'production'}

    def test_signed_mac_entitlements_match_real_archive(self):
        v.check_mac_entitlements(self.signed(), self.p['macProfiles']['app'], self.p)
        for key, value in [('com.apple.security.app-sandbox', None), ('aps-environment', 'development'), ('get-task-allow', True),
                           ('com.apple.security.network.client', None), ('com.apple.security.application-groups', ['group.other'])]:
            with self.subTest(key=key):
                e = self.signed()
                if value is None: e.pop(key)
                else: e[key] = value
                with self.assertRaisesRegex(ValueError, key.replace('.', '[.]')):
                    v.check_mac_entitlements(e, self.p['macProfiles']['app'], self.p)

    def test_mac_profile_installs_as_provisionprofile(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root); src = root/'source'; src.mkdir(); dest = root/'cache'
            (src/'app.provisionprofile').write_bytes(b'mac')
            with patch.object(v, 'decode', lambda path: self.profile()):
                v.install_profiles(src, self.cert, dest, self.p, platform='mac')
            self.assertEqual([p.name for p in dest.iterdir()], [self.p['macProfiles']['app']['uuid'] + '.provisionprofile'])

    def test_mac_export_is_app_store_eligible_and_installer_signed(self):
        options = v.export_options(self.p, 'mac', 'a' * 40)
        self.assertIs(options['testFlightInternalTestingOnly'], False)
        self.assertEqual(options['installerSigningCertificate'], 'A' * 40)
        self.assertEqual(options['provisioningProfiles'], {self.p['macProfiles']['app']['bundleId']: self.p['macProfiles']['app']['uuid']})
        with self.assertRaises(ValueError): v.export_options(self.p, 'mac', None)
        self.assertNotIn('installerSigningCertificate', v.export_options(self.p))

    def test_installer_identity_requires_exactly_one_team_installer(self):
        sha = 'B' * 40
        good = f'  1) {"9" * 40} "Apple Distribution: James Greco (V6JPQCD336)"\n  2) {sha} "3rd Party Mac Developer Installer: James Greco (V6JPQCD336)"\n'
        self.assertEqual(v.installer_identity(good, self.p), sha)
        self.assertEqual(v.installer_identity(good.replace('3rd Party Mac Developer Installer', 'Mac Installer Distribution'), self.p), sha)
        for identities in ['', good.replace('V6JPQCD336)"\n  2', 'X)"\n  2').replace('(V6JPQCD336)"\n', '(OTHERTEAM)"\n'),
                           good + f'  3) {"C" * 40} "Mac Installer Distribution: James Greco (V6JPQCD336)"\n']:
            with self.subTest(identities=identities):
                with self.assertRaises(ValueError): v.installer_identity(identities, self.p)


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.p = copy.deepcopy(v.POLICY)
        self.sha, self.build = 'a'*40, '999'

    def package(self, path, change=None, omit_extension=False, extra_extension=False):
        with zipfile.ZipFile(path, 'w') as archive:
            for name, target in self.p['profiles'].items():
                if name != 'app' and omit_extension: continue
                prefix = 'Payload/Example.app/' + ('' if name == 'app' else 'PlugIns/Extension.appex/')
                info = {'CFBundleIdentifier':target['bundleId'], 'CFBundleVersion':self.build,
                        'CFBundleShortVersionString':self.p['marketingVersion'], 'ReleaseCommit':self.sha,
                        'DTPlatformName':'iphoneos'}
                if name=='app' and self.p['apiOrigin']: info['API_BASE_URL']=self.p['apiOrigin']
                if change: info.update(change)
                archive.writestr(prefix+'Info.plist',plistlib.dumps(info))
                archive.writestr(prefix+'embedded.mobileprovision',b'synthetic-profile')
            if extra_extension: archive.writestr('Payload/Example.app/PlugIns/Extra.appex/Info.plist',plistlib.dumps(info))

    def test_complete_metadata(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'fixture.ipa'; self.package(path)
            self.assertEqual(len(v.inspect_package(path,self.sha,self.build,self.p)),len(self.p['profiles']))

    def test_metadata_mismatches(self):
        changes={'CFBundleIdentifier':'other.app','CFBundleVersion':'998','CFBundleShortVersionString':'9.9',
                 'ReleaseCommit':'b'*40,'DTPlatformName':'iphonesimulator'}
        if self.p['apiOrigin']: changes['API_BASE_URL']='https://example.invalid'
        with tempfile.TemporaryDirectory() as root:
            for key,value in changes.items():
                with self.subTest(key=key):
                    path=Path(root)/'fixture.ipa'; self.package(path,{key:value})
                    with self.assertRaises(ValueError):v.inspect_package(path,self.sha,self.build,self.p)

    def test_extension_topology(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'fixture.ipa'; self.package(path,extra_extension=True)
            with self.assertRaises(ValueError):v.inspect_package(path,self.sha,self.build,self.p)
            if len(self.p['profiles'])>1:
                self.package(path,omit_extension=True)
                with self.assertRaises(ValueError):v.inspect_package(path,self.sha,self.build,self.p)

    def test_zip_traversal(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'fixture.ipa'; self.package(path)
            with zipfile.ZipFile(path,'a') as archive: archive.writestr('../escape',b'')
            with self.assertRaises(ValueError):v.inspect_package(path,self.sha,self.build,self.p)

    def test_nested_unapproved_app(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'fixture.ipa'; self.package(path)
            with zipfile.ZipFile(path,'a') as archive:
                archive.writestr('Payload/Example.app/Watch/Other.app/Info.plist',plistlib.dumps({}))
            with self.assertRaises(ValueError):v.inspect_package(path,self.sha,self.build,self.p)

    def test_internal_only_manual_export(self):
        options=v.export_options(self.p)
        self.assertIs(options['testFlightInternalTestingOnly'],False)
        self.assertIs(options['manageAppVersionAndBuildNumber'],False)
        self.assertEqual(options['destination'],'export')
        self.assertEqual(options['signingStyle'],'manual')
        self.assertEqual(options['signingCertificate'],self.p['certificateSha1'])
        self.assertEqual(set(options['provisioningProfiles'].values()),{t['uuid'] for t in self.p['profiles'].values()})

    def test_source_ref_and_count(self):
        with patch.object(v,'run',side_effect=[(self.sha+'\n').encode(),b'999\n']):v.identity(self.sha,self.build)
        with patch.object(v,'run',return_value=b'wrong\n'):
            with self.assertRaises(ValueError):v.identity(self.sha,self.build)
        with patch.object(v,'run',side_effect=[(self.sha+'\n').encode(),b'998\n']):
            with self.assertRaises(ValueError):v.identity(self.sha,self.build)


if __name__ == '__main__':
    unittest.main(verbosity=2)
