



# Hive

A study app for UC CITCS. Every course (BSIT, BSCS, BSIS) has its own space, and everyone feeds the same hive.

**Open it at [tinyurl.com/hive-kk](https://tinyurl.com/hive-kk)**

https://github.com/user-attachments/assets/a62b0b91-19cf-477c-88de-56adb439ef37

| Hive part | In the app |
|---|---|
| Hive | The whole app, for all of CITCS |
| Combs | Courses, each with its own subjects |
| Cells | Subjects (shared ones like ENG100 appear for every course) |
| Workers and nectar | Students and the lessons they upload |
| Honey | The finished notes and quizzes |
| Beekeeper | You, the admin |

Hive has two sides. The first time someone opens it, it asks **Review** or **Upload** (only once). After that, the button at the top right switches between them.

- **Review:** pick a course from the honeycomb button, pick an exam tab (*Midterms*, *Finals*…), then tap a subject in the hive. Each subject has lessons with a **Notes** tab and a **Quiz** tab. Best quiz scores are remembered on the phone, and every reviewer is saved for offline use after the first visit.
- **Upload:** students send lecture slides, modules and handouts, and you turn them into notes and quizzes.

How the upload side works:

- **No student accounts.** Students type a shared **upload code** that you post in the Discord server.
- **Works with weak signal.** Files are saved on the phone first and sent automatically when the connection comes back. Large uploads resume where they stopped instead of starting over.
- **Small storage.** Only PDF, Word (.doc/.docx) and PowerPoint (.ppt/.pptx) files up to 20 MB are allowed. The page checks each file's real contents, not just its name, and identical files are stored only once.
- **Private.** Only you, signed in on `admin.html`, can see or download the files.

| File | What it is |
|---|---|
| `index.html` | The app shell: the Review / Upload choice, the reviewer and the upload page |
| `reviewer.js` | The reviewer: hive of subjects, course picker, exam tabs, notes and quiz |
| `reviewer/` | The reviewer content: `lessons.json`, `notes/*.txt`, `quiz/*.json` (see *Adding reviewers* below) |
| `app.js` | The upload page (works offline, can be installed like an app) |
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
3. After a minute it's live at `https://kurtking514-byte.github.io/Hive/` (capital H, the link is case-sensitive). The short link for the Discord server is <https://tinyurl.com/hive-kk>.

### 4. Set the upload code
Open `.../admin.html` and sign in. Under **Upload code**, choose a code (default is `CITCS`; students can type it in any capitals). Post it in the Discord server together with the link.

## Day to day
- **Admin page:** filter by *Pending*, open each file, then **Approve** (keep), **Reject** (wrong, blurry or off-topic) or **Mark used** once it's in a reviewer.
- **What the hive has, by course** shows shared subjects first, then each course, so you can see which subject and exam combinations still have no files.
- **Export CSV** gives a list for your own tracking.
- **Storage:** the free plan has 1 GB of file storage. After an exam, delete files you've already turned into reviewers.
- **If the code leaks** outside your class, change it on the admin page. Files already uploaded stay where they are.

## Adding reviewers
Each lesson needs three things in `reviewer/`.

1. **An entry in `lessons.json`:**
   ```json
   { "id": "cc1-L5", "subject": "CC1", "tab": "Lesson 5", "title": "Number Systems",
     "notes": true, "quiz": 30, "course": "BSCS", "exam": "Finals" }
   ```
   `id` names the two files below. `subject` must match a subject code in `config.js`. `exam` is `Prelim`, `Midterm` or `Finals`. `course` is the course it was made for (shared subjects still show under every course).
2. **`notes/<id>.txt`**, plain text. The first line is the title and isn't shown. Then:
   - a line in ALL CAPS is a heading
   - `★` starts a key point or definition
   - `EASIER:` starts a simpler explanation
   - `⚙` starts a practice item
3. **`quiz/<id>.json`**, a list of questions. `answer` is the position of the right option, counting from 0:
   ```json
   [{ "q": "Which set correctly lists the three things a computer does?",
      "options": ["Accepts input, executes a procedure, produces output", "…", "…", "…"],
      "answer": 0,
      "explanation": "A computer accepts input, follows a mechanical procedure, and produces output." }]
   ```

The reviewer opens on the **Current exam** you set on the admin page. Older exams stay one tab away.

## Updating the site later
After changing any file, raise the number in `sw.js` (for example `hive-v27` → `hive-v28`) so phones pick up the new version.

## Test locally
```bash
npx serve .
```
Then open the address it prints. Offline mode and file fingerprinting need `localhost` or `https`.
