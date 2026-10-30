# Deploying Questlog to Vercel

This guide is for the owner. It covers the steps that need your own accounts. Never paste a key into chat or into a file in this repository: type them only into the dashboards named below.

**What "deploying" means.** Vercel builds the app from the `main` branch of the GitHub repository and serves it on the internet at `https://<your-project-name>.vercel.app`. From then on, every change merged into `main` goes live by itself. Branches and pull requests are **not** deployed (the owner's choice: nothing but merged code ever runs on the real site, and a test copy can never touch real data). That rule lives in `vercel.json`.

**What stays the same.** The database is the Supabase project you already use. The site and your local `npm run dev` therefore share the same data.

## Part 1: Vercel

1. Go to <https://vercel.com/signup> and choose **Continue with GitHub**. Pick the free **Hobby** plan. (Hobby is for personal, non-commercial use; that is what this is.)
2. **Add New... > Project.** Under "Import Git Repository", when asked, let the Vercel GitHub app access **only** the `questlog` repository (not all repositories). Click **Import** beside it.
3. On the configuration screen:
   - **Project Name:** choose something short and unique, for example `questlog-yourname`. Your address will be `https://<that-name>.vercel.app`. If the name is taken, Vercel says so; pick another. **Write the final address down**, you need it in three places below.
   - **Framework Preset:** it should say **Next.js**. Leave the build settings alone (`vercel.json` already sets the region to Stockholm, next to your database).
   - **Environment Variables:** open this section and add these three (copy the values from your `.env.local` file, **never** from chat):

     | Name                                   | Value                                                           |
     | -------------------------------------- | --------------------------------------------------------------- |
     | `NEXT_PUBLIC_APP_URL`                  | `https://<your-project-name>.vercel.app` (https, no trailing /) |
     | `NEXT_PUBLIC_SUPABASE_URL`             | the same Supabase address as in `.env.local`                    |
     | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the same `sb_publishable_...` key as in `.env.local`            |

     Do **not** add any key that starts with `sb_secret_`. The app never needs it, and it would refuse a secret key in the public slot anyway.

   - Click **Deploy**. It takes a minute or two.

4. When it finishes, open **Project > Settings > General** and check **Node.js Version** says **24.x** (the project needs Node 24). If it does not, change it and redeploy from **Deployments**.
5. Open **Settings > Git** and check **Production Branch** is `main`.
6. Open your address in a **private/incognito window**. You should see the Questlog login page, **not** a Vercel login. If Vercel asks you to sign in to view the site, tell me: a deployment-protection setting needs changing.

If the site shows an error instead, open **Deployments > (latest) > Logs**. "Invalid environment configuration" means a variable above is missing or mistyped (the app names the variable, never its value); fix it in **Settings > Environment Variables** and redeploy.

## Part 2: Supabase (tell it about the new address)

Dashboard > **Authentication > URL Configuration**:

- **Site URL:** change it to `https://<your-project-name>.vercel.app`.
- **Redirect URLs:** **add** `https://<your-project-name>.vercel.app/auth/callback`. **Keep** `http://localhost:3000/auth/callback` for now (see "Accepted for now" below).

Why: after Google sign-in, Supabase only sends the browser to addresses on this list. An address that is not listed is refused, which is what stops an attacker's site from receiving a sign-in.

## Part 3: Google

No change is needed. Google sends people to Supabase's own callback address (`https://<ref>.supabase.co/auth/v1/callback`), which has not changed; Supabase then sends them on to the allowed address from Part 2. (Adding the new address under **Authorized JavaScript origins** in Google Cloud is harmless but not required.)

## Part 4: Rate-limit the sign-in return address

Vercel's firewall can limit how often one visitor may hit `/auth/callback` (the page Google sends people back to). This is free on the Hobby plan (one rule).

Vercel > your project > **Firewall > Configure > + New Rule**:

- **Name:** Limit sign-in callback
- **If:** Request Path **equals** `/auth/callback`
- **Then:** **Rate Limit**, **Fixed Window**, **Time Window** 60 seconds, **Request Limit** 20, key **IP**, action **Default (429)**
- **Save Rule**, then **Review Changes > Publish**.

20 a minute is far more than a person needs (one sign-in is one request), and far less than a script would send.

## Part 5: Check it

1. Tell me the address. I will run the automated check, which makes about twenty ordinary requests like a stranger would and judges the answers (headers, redirects, nonce, no leaked files):

   ```bash
   npm run check:live -- https://<your-project-name>.vercel.app
   ```

2. Then try it yourself, in a private window: **Sign in with Google**. You should land on the home page on the **vercel.app** address, signed in. Add a quest, complete it, delete it and look at the Trash.
3. Try the same Google sign-in with a different Google account if you have one: it must be refused (the allow-list, from slice 2).

## Day to day

- **Every merge to `main` deploys by itself.** Watch **Deployments** in Vercel if you are curious. A failed build never replaces the working site.
- **Roll back:** Vercel > **Deployments** > pick an older green one > **...** > **Promote to Production** (or **Instant Rollback**). It takes seconds.
- **Database changes are separate.** `npx.cmd supabase db push` changes the real database, which the live site uses at once. A migration pull request will say whether to apply the migration **before** or **after** you merge it, because the old code and the new code must both work in the gap. Never merge first and apply later unless the pull request says so.
- **Redeploy after changing an environment variable** (Deployments > ... > Redeploy), because a running deployment keeps the values it started with.
- The check can be run again at any time, for example after changing a setting.

## Accepted for now

- **One Supabase project is both "development" and "production".** Your local `npm run dev` therefore signs in against the real database, and `http://localhost:3000/auth/callback` stays on the redirect list. The risk is small (an attacker would have to run a server on your own computer), but the clean fix is a second, empty Supabase project for development. Do that before real data matters (Phase 2). Recorded as accepted risk A5 in `docs/THREAT-MODEL.md`.

## If something goes wrong

| What you see                                                      | Likely cause                                                                                                                                                    |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| After Google sign-in you land on `localhost`                      | `NEXT_PUBLIC_APP_URL` holds the wrong address. (If it is missing or not https, the sign-in return page shows an error instead, by design.) Fix it and redeploy. |
| Supabase says the redirect URL is not allowed                     | The `.../auth/callback` address is missing from **Redirect URLs** (Part 2), or has a typo or a trailing slash.                                                  |
| Google shows `redirect_uri_mismatch`                              | The Supabase callback in Google Cloud was changed. It must be exactly `https://<ref>.supabase.co/auth/v1/callback`.                                             |
| An error page that says "Invalid environment configuration"       | A variable from Part 1 is missing or mistyped, or the Supabase key slot holds the wrong kind of key. The logs name the variable.                                |
| Sign-in says "too many requests" (429) when you are the only user | The firewall rule is too strict, or you retried many times within a minute. Wait a minute; raise the limit only if it keeps happening.                          |
| The live check fails                                              | Read the line under each FAIL: it says what it expected and what it got. Send it to me.                                                                         |
