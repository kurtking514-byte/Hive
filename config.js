/* =====================================================================
   Site settings — edit this file, nothing else needs changing.
   supabaseUrl / supabaseKey: Supabase Dashboard → Project Settings → API
   (the "Project URL" and the "anon public" / "publishable" key).
   That key is meant to be public; the database rules in supabase/setup.sql
   are what keep uploads private.
   ===================================================================== */
window.APP_CONFIG = {
  supabaseUrl: "https://pvshylagmvcbmfqoczyy.supabase.co",
  supabaseKey: "sb_publishable_5sD7QU0Eik0baJGwRNb37w_EtmOVb_h",
  bucket: "uploads",
  maxFileMB: 20,

  defaultExamPeriod: "Finals",
  examPeriods: ["Prelim", "Midterm", "Finals"],

  /* The "combs" of the hive: each course gets its own space. */
  courses: ["BSIT", "BSCS", "BSIS"],

  /* courses: "all"            → shared, shows for every course (GE and common CC subjects)
     courses: ["BSIT", "BSCS"]  → shows only for those courses
     Students picking a course see that course's subjects first, then the shared ones. */
  subjects: [
    { id: "CC1", name: "Computing Fundamentals", courses: "all" },
    { id: "CC2", name: "Computer Programming", courses: "all" },
    { id: "CC7", name: "Human-Computer Interaction", courses: "all" },
    { id: "ENG100", name: "Purposive Communication", courses: "all" },
    { id: "HIST100", name: "Readings in Philippine History", courses: "all" },
    { id: "MATH100", name: "Mathematics in the Modern World", courses: "all" },
    { id: "PATHFIT1", name: "Movement Competency Training", courses: "all" }
    /* Example of a course-only subject:
    , { id: "IT101", name: "Some BSIT-only subject", courses: ["BSIT"] } */
  ],

  /* Suggestions only — students can still type any teacher's name. */
  teachers: [],

  materialTypes: ["Lecture slides", "Lesson / module", "Handout / notes", "Activity / exercise", "Other"]
};
