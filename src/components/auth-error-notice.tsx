import Link from "next/link";

export function authErrorMessage(reason?: string | string[]) {
  if (!reason) return null;
  switch (reason) {
    case "denied": return "Google sign-in was canceled or permission was declined. Your existing plans are unchanged.";
    case "state": return "Your sign-in attempt expired or could not be verified. Start again to continue safely.";
    case "apple": return "Apple sign-in could not be completed. Please try again.";
    default: return "Google sign-in could not be completed. Please try again.";
  }
}

export function AuthErrorNotice({ reason }: { reason?: string | string[] }) {
  const message = authErrorMessage(reason);
  if (!message) return null;
  return <div className="auth-error-notice" role="alert"><p>{message}</p><Link className="button button-secondary" href={reason === "apple" ? "/auth/apple" : "/auth/google"}>Try sign-in again</Link></div>;
}
