export function bearerTokenForAuthorization(value: string | null): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^Bearer ([A-Za-z0-9_-]{20,128})$/);
  return match?.[1];
}
