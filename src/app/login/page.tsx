import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { GoogleSignInButton } from "./google-sign-in-button";

// Messages are looked up by code. Text from the URL is never shown, so a crafted link cannot put
// words in our mouth or inject markup.
const ERROR_MESSAGES: Record<string, string> = {
  signin_failed: "Sign-in didn't complete, or this Google account isn't allowed to use Questlog.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  if (await getCurrentUser()) redirect("/");

  const { error } = await searchParams;
  const message = typeof error === "string" ? ERROR_MESSAGES[error] : undefined;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <section className="w-full max-w-md rounded-lg border-2 border-panel-border bg-linear-to-b from-panel-from to-panel-to p-6 shadow-lg">
        <h1 className="text-2xl font-bold tracking-wide">Questlog</h1>
        <p className="mt-3 mb-6">Your adventure begins when you sign in.</p>
        {message && (
          <p role="alert" className="mb-4 rounded border-2 border-panel-border p-3">
            {message}
          </p>
        )}
        <GoogleSignInButton />
      </section>
    </main>
  );
}
