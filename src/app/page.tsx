import { signOut } from "@/app/auth/actions";
import { requireUser } from "@/lib/auth/session";

export default async function Home() {
  const user = await requireUser();

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <section className="w-full max-w-md rounded-lg border-2 border-panel-border bg-linear-to-b from-panel-from to-panel-to p-6 shadow-lg">
        <h1 className="text-2xl font-bold tracking-wide">Questlog</h1>
        <p className="mt-3">Your adventure begins soon.</p>
        <p className="mt-3 text-sm">Signed in as {user.email}</p>
        <form action={signOut} className="mt-6">
          <button
            type="submit"
            className="w-full rounded border-2 border-panel-border bg-background px-4 py-3 font-bold hover:bg-panel-from focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-panel-border"
          >
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}
