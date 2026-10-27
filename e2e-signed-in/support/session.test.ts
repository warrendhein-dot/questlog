import { describe, expect, it } from "vitest";
import { sessionCookieName, withDamagedSignature, type SessionCookie } from "./session";

const encode = (session: object) =>
  `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
const decode = (value: string) =>
  JSON.parse(Buffer.from(value.slice("base64-".length), "base64url").toString());

describe("sessionCookieName", () => {
  it("uses the first part of the host, which is how the Supabase library names it", () => {
    expect(sessionCookieName("http://127.0.0.1:54321")).toBe("sb-127-auth-token");
    expect(sessionCookieName("https://abcdefgh.supabase.co")).toBe("sb-abcdefgh-auth-token");
    expect(sessionCookieName("http://localhost:54321")).toBe("sb-localhost-auth-token");
  });
});

describe("withDamagedSignature", () => {
  const session = {
    // Obviously fake and low-entropy, so the secret scanner never mistakes it for a real token.
    access_token: "xxxxxx.yyyyyy.zzzzzzzzzzzz",
    refresh_token: "refresh-me",
    user: { id: "u1" },
  };
  const cookies: SessionCookie[] = [{ name: "sb-127-auth-token", value: encode(session) }];

  it("changes the end of the access token, where the signature is", () => {
    const [damaged] = withDamagedSignature(cookies);
    const result = decode(damaged!.value);
    expect(result.access_token).not.toBe(session.access_token);
    expect(result.access_token.startsWith("xxxxxx.yyyyyy.zzzzzz")).toBe(true);
    expect(result.access_token.endsWith("AAAAAA")).toBe(true);
    expect(result.access_token).toHaveLength(session.access_token.length);
  });

  it("leaves everything else in the session alone", () => {
    const result = decode(withDamagedSignature(cookies)[0]!.value);
    expect(result.refresh_token).toBe("refresh-me");
    expect(result.user).toEqual({ id: "u1" });
  });

  it("keeps the cookie's name and the base64- format the app reads", () => {
    const [damaged] = withDamagedSignature(cookies);
    expect(damaged!.name).toBe("sb-127-auth-token");
    expect(damaged!.value.startsWith("base64-")).toBe(true);
  });

  it("passes cookies in any other format through untouched", () => {
    const plain: SessionCookie[] = [{ name: "other", value: "not-a-session" }];
    expect(withDamagedSignature(plain)).toEqual(plain);
  });

  it("does not modify the original cookies", () => {
    const before = cookies[0]!.value;
    withDamagedSignature(cookies);
    expect(cookies[0]!.value).toBe(before);
  });
});
