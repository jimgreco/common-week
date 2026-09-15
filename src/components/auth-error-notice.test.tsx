import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthErrorNotice } from "./auth-error-notice";
describe("sign-in recovery", () => {
  it.each([["denied", /permission was declined/], ["state", /expired/], ["callback", /could not be completed/]])("explains %s and offers a fresh sign-in", (reason, message) => {
    render(<AuthErrorNotice reason={reason as string} />);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("link", { name: "Try sign-in again" })).toHaveAttribute("href", "/auth/google");
  });
  it("never reflects untrusted callback text", () => {
    render(<AuthErrorNotice reason="untrusted-provider-secret" />);
    expect(screen.queryByText(/untrusted-provider-secret/)).not.toBeInTheDocument();
  });
});
