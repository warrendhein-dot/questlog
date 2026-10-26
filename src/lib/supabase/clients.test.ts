import { beforeEach, describe, expect, it, vi } from "vitest";

const createServerClient = vi.fn(() => ({ kind: "server" }));
const createBrowserClient = vi.fn(() => ({ kind: "browser" }));
const cookieStore = {
  getAll: vi.fn(() => [{ name: "sb-token", value: "abc" }]),
  set: vi.fn(),
};

vi.mock("@supabase/ssr", () => ({ createServerClient, createBrowserClient }));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

const URL = "https://abcdefgh.supabase.co";
const KEY = "sb_publishable_example";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", KEY);
});

describe("createSupabaseServerClient", () => {
  it("builds a client from the validated URL and publishable key", async () => {
    const { createSupabaseServerClient } = await import("./server");
    await createSupabaseServerClient();
    expect(createServerClient).toHaveBeenCalledWith(URL, KEY, expect.any(Object));
  });

  it("reads and writes the session through the request cookies", async () => {
    const { createSupabaseServerClient } = await import("./server");
    await createSupabaseServerClient();
    const calls = createServerClient.mock.calls as unknown as [
      string,
      string,
      {
        cookies: {
          getAll: () => unknown;
          setAll: (c: { name: string; value: string; options?: object }[]) => void;
        };
      },
    ][];
    const adapter = calls[0]![2].cookies;

    expect(adapter.getAll()).toEqual([{ name: "sb-token", value: "abc" }]);
    adapter.setAll([{ name: "sb-token", value: "new", options: { path: "/" } }]);
    expect(cookieStore.set).toHaveBeenCalledWith("sb-token", "new", { path: "/" });
  });

  it("does not crash when cookies cannot be set (Server Components)", async () => {
    cookieStore.set.mockImplementationOnce(() => {
      throw new Error("Cookies can only be modified in a Server Action or Route Handler");
    });
    const { createSupabaseServerClient } = await import("./server");
    await createSupabaseServerClient();
    const calls = createServerClient.mock.calls as unknown as [
      string,
      string,
      { cookies: { setAll: (c: { name: string; value: string }[]) => void } },
    ][];
    expect(() => calls[0]![2].cookies.setAll([{ name: "a", value: "b" }])).not.toThrow();
  });

  it("refuses to build a client when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const { createSupabaseServerClient } = await import("./server");
    await expect(createSupabaseServerClient()).rejects.toThrow(/Invalid environment configuration/);
    expect(createServerClient).not.toHaveBeenCalled();
  });
});

describe("createSupabaseBrowserClient", () => {
  it("builds a client from the validated URL and publishable key only", async () => {
    const { createSupabaseBrowserClient } = await import("./browser");
    createSupabaseBrowserClient();
    expect(createBrowserClient).toHaveBeenCalledWith(URL, KEY);
  });
});
