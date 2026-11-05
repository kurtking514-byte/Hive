# Hive

**Many courses. One hive.** A study app for UC CITCS. Every course (BSIT, BSCS, BSIS, ACT) has its own space, and everyone feeds the same hive.

| Hive part | In the app |
|---|---|
| Hive | The whole app, for all of CITCS |
| Combs | Courses, each with its own subjects |
| Cells | Subjects (shared ones like ENG100 appear for every course) |
| Workers and nectar | Students and the lessons they upload |
| Honey | The finished notes and quizzes |
| Beekeeper | You, the admin |

This part is the **upload site**: students send lecture slides, modules and handouts, and you turn them into notes and quizzes.

- **No student accounts.** Students type a shared **upload code** that you post in the class group chat.
- **Works with weak signal.** Files are saved on the phone first and sent automatically when the connection comes back. Large uploads resume where they stopped instead of starting over.
- **Small storage.** Only PDF, Word (.doc/.docx) and PowerPoint (.ppt/.pptx) files up to 20 MB are allowed. The page checks each file's real contents, not just its name, and identical files are stored only once.
- **Private.** Only you, signed in on `admin.html`, can see or download the files.

| File | What it is |
|---|---|
| `index.html`, `app.js` | Student upload page (works offline, can be installed like an app) |
| `admin.html`, `admin.js` | Your page: review, open/download, approve/reject, see which subjects need files, change the code |
| `config.js` | **The only file you edit**: Supabase keys, courses, subjects, teachers |
| `supabase/setup.sql` | Database, storage and security rules (run once) |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Offline support and app icon |

## Setup (about 15 minutes, free)

### 1. Create the Supabase project
1. Sign up at <https://supabase.com> and click **New project** (Free plan). Pick the region closest to you (Singapore).
2. Open **SQL Editor → New query**, paste all of `supabase/setup.sql`, and click **Run**.
3. Go to **Authentication → Users → Add user → Create new user**. Enter your email and a strong password and tick **Auto Confirm User**.
4. Back in **SQL Editor**, run this with your email:
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'YOUR-EMAIL@example.com'
   on conflict do nothing;
   ```
5. Optional but recommended: in **Authentication → Sign In / Providers**, turn off **Allow new users to sign up**. Only you need an account.

### 2. Connect the site
Open **Project Settings → API** (or **API Keys**). Copy the **Project URL** and the **anon public** (or **publishable**) key into `config.js`:
```js
supabaseUrl: "https://abcdefgh.supabase.co",
supabaseKey: "eyJhbGciOi...",
```
**Never** put the `service_role` / secret key here. The anon/publishable key is meant to be public.

Also check the `courses`, `subjects` and `teachers` lists in `config.js`. Mark each subject `courses: "all"` (shared by every course) or list the courses it belongs to, for example `courses: ["BSIT"]`.

### 3. Put it online (GitHub Pages, free)
1. Push these files to <https://github.com/kurtking514-byte/Hive>.
2. Go to **Settings → Pages**. Set **Source** to *Deploy from a branch*, choose `main` / root, and click **Save**.
3. After a minute it's live at `https://kurtking514-byte.github.io/Hive/` (capital H, the link is case-sensitive). Make a short link (tinyurl) for the group chat.

### 4. Set the upload code
Open `.../admin.html` and sign in. Under **Upload code**, choose a code (default is `CITCS`; students can type it in any capitals). Post it in your class group chat together with the link.

## Day to day
- **Admin page:** filter by *Pending*, open each file, then **Approve** (keep), **Reject** (wrong, blurry or off-topic) or **Mark used** once it's in a reviewer.
- **What the hive has, by course** shows shared subjects first, then each course, so you can see which subject and exam combinations still have no files.
- **Export CSV** gives a list for your own tracking.
- **Storage:** the free plan has 1 GB of file storage. After an exam, delete files you've already turned into reviewers.
- **If the code leaks** outside your class, change it on the admin page. Files already uploaded stay where they are.

## Updating the site later
After changing any file, raise the number in `sw.js` (`hive-v1` → `hive-v2`) so phones pick up the new version.

## Test locally
```bash
npx serve .
```
Then open the address it prints. Offline mode and file fingerprinting need `localhost` or `https`.
