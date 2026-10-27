# Setting up Google sign-in (one-time, by the owner)

Slice 2 adds "Sign in with Google". The code is in the repository, but three things can only be done by the account owner, in the Google Cloud and Supabase dashboards. **Never paste a client secret into chat, a file in the repo, or a pull request.** The secret goes only into the Supabase dashboard.

Dashboard wording changes from time to time. If a label differs slightly, look for the closest match.

Values used below:

- `YOUR-PROJECT-REF`: the first part of your Supabase project URL (`https://YOUR-PROJECT-REF.supabase.co`).
- `YOUR-GMAIL`: the Google account that is allowed to sign in, in lower case.

## Part 1. Google Cloud: create the OAuth client

1. Go to https://console.cloud.google.com and sign in with your Google account.
2. Click the project picker at the top, then **New project**. Name it `Questlog` and click **Create**. Make sure it is the selected project.
3. Open the menu (top left) and choose **Google Auth Platform** (if you only see **APIs & Services**, open **OAuth consent screen**). Click **Get started**.
4. **App information:** App name `Questlog`, and your email as the user support email. Click **Next**.
5. **Audience:** choose **External**. Click **Next**.
6. **Contact information:** your email. Click **Next**, accept the user data policy, click **Continue**, then **Create**.
7. Open **Audience**. Leave the publishing status as **Testing**. Under **Test users** click **Add users** and add `YOUR-GMAIL`. While the app is in Testing, only listed test users can sign in at all, which is a second lock in front of our own allow-list.
8. Open **Data Access** and make sure only these scopes are present: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`. Do not add any others. (Gmail and Calendar access comes in a later phase, with its own consent.)
9. Open **Clients** and click **Create client**.
   - Application type: **Web application**. Name: `Questlog web`.
   - **Authorized JavaScript origins:** add `http://localhost:3000`.
   - **Authorized redirect URIs:** add `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`. This is Supabase's address, not the app's: Google sends the browser to Supabase, which then sends it to our app.
   - Click **Create**.
10. A dialog shows the **Client ID** and **Client secret**. Keep this window open for Part 2. Treat the secret like a password.

## Part 2. Supabase dashboard: switch on Google and lock down the rest

Open your project at https://supabase.com/dashboard.

1. **Authentication > Sign In / Providers > Google**
   - Turn it on. Paste the **Client ID** and **Client secret** from Google.
   - Leave **Skip nonce checks** off. Click **Save**.
2. **Authentication > Sign In / Providers > Email**
   - Turn **off** the email provider (the "Enable Email provider" switch). We only use Google, and leaving email sign-up open is how an attacker could try to register your address before you do (see threat 18 in `docs/THREAT-MODEL.md`). Click **Save**.
3. **Authentication > URL Configuration**
   - **Site URL:** `http://localhost:3000`
   - **Redirect URLs:** add `http://localhost:3000/auth/callback`
   - Click **Save**. For production later, this list changes to the production address only.

## Part 3. After the slice 2 pull request is merged

1. **Apply the new database migration** (it creates the allow-list and the hook function). In a terminal in the project folder, on the `main` branch after `git pull`:

   ```bash
   npx.cmd supabase db push --dry-run
   ```

   It should list one migration, `20261026120000_signup_allowlist.sql`. Then:

   ```bash
   npx.cmd supabase db push
   ```

2. **Add yourself to the allow-list.** In the Supabase dashboard open **SQL Editor**, run this with your own address in lower case, and check it reports success:

   ```sql
   insert into public.allowed_emails (email) values ('YOUR-GMAIL');
   ```

   Your address lives only in your database, never in this public repository.

3. **Switch on the sign-up hook.** Open **Authentication > Auth Hooks** (sometimes shown under **Hooks**). Add the **Before User Created** hook, choose **Postgres function**, schema `public`, function `hook_restrict_signup`, and save.

4. **Try it.** Make sure `.env.local` is filled in, run `npm run dev`, open http://localhost:3000. You should land on the login page. Click **Sign in with Google**, choose `YOUR-GMAIL`, and you should arrive at the home page showing "Signed in as ...".

## If something goes wrong

| What you see                                                | Likely cause                                                                                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Google shows `redirect_uri_mismatch`                        | The redirect URI in Google Cloud does not exactly match `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`.                       |
| Google says the app is blocked or you are not a tester      | `YOUR-GMAIL` is not in the **Test users** list (Part 1, step 7).                                                                       |
| Back on the login page with "isn't allowed to use Questlog" | Your address is not in `allowed_emails`, the hook is misspelled, or sign-in was cancelled. Check the SQL Editor row and the hook name. |
| Supabase says the redirect URL is not allowed               | `http://localhost:3000/auth/callback` is missing from **Redirect URLs** (Part 2, step 3).                                              |
| Page shows an error about invalid environment configuration | `.env.local` is empty, unsaved, or contains the wrong key type. Restart `npm run dev` after saving.                                    |
