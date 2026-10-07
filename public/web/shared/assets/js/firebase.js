/*
 * FarmLink Firebase data layer
 *
 * 1. Create a Firebase web app.
 * 2. Enable Phone Authentication, Cloud Firestore and Firebase Storage.
 * 3. Paste its public web configuration below.
 *
 * Until then, the prototype stays usable with browser-local demo data. The
 * Firebase config is public by design; protect data using Firestore and Storage
 * Security Rules, never by hiding it in this file.
 */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAIO0-ZGvAeFhgw1JjdIZqL9_O08rMK99E",
  authDomain: "framlink-sih.firebaseapp.com",
  projectId: "framlink-sih",
  storageBucket: "framlink-sih.firebasestorage.app",
  messagingSenderId: "236722467283",
  appId: "1:236722467283:web:7cb752aaeaa07f98f33f26",
};

const hasFirebaseConfig = Boolean(
  FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId && FIREBASE_CONFIG.appId,
);

// This project is currently using a Firebase Console test phone number. Set to
// false before allowing real customer phone numbers in production.
const FIREBASE_USE_TEST_PHONE_AUTH = true;

window.firebaseClient = null;
window.firebaseMode = hasFirebaseConfig ? "firebase" : "demo";

const localKey = (collection) => `farmlink_firebase_${collection}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const idFor = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function demoRows(collection) {
  try {
    return JSON.parse(localStorage.getItem(localKey(collection)) || "[]");
  } catch {
    return [];
  }
}

function saveDemoRows(collection, rows) {
  localStorage.setItem(localKey(collection), JSON.stringify(rows));
}

function currentDemoUser() {
  const stored = localStorage.getItem("farmlink_firebase_user");
  return stored ? JSON.parse(stored) : null;
}

function firestoreAdapter(firebase) {
  const db = firebase.firestore();
  // Avoid browser QUIC/WebChannel transport failures on local and hosted
  // networks that interrupt Firestore auth/session and document requests.
  db.settings({
    experimentalForceLongPolling: true,
    experimentalAutoDetectLongPolling: false,
    useFetchStreams: false,
    merge: true,
  });
  const storage = firebase.storage();
  const authInstance = firebase.auth();
  // A page reload can run before Firebase restores its persisted phone session.
  // Wait for the first auth-state callback so protected pages do not redirect a
  // just-verified user back to login.
  const authStateReady = new Promise((resolve) => {
    let unsubscribe = () => {};
    unsubscribe = authInstance.onAuthStateChanged((user) => {
      unsubscribe();
      resolve(user);
    });
  });

  function builder(collection) {
    const state = {
      filters: [],
      order: null,
      action: "select",
      payload: null,
      returnSingle: false,
    };
    const api = {
      // In Supabase, .select() after insert/update only requests returned rows;
      // it must not turn a pending write back into a read query.
      select() {
        return api;
      },
      eq(field, value) {
        state.filters.push([field, value]);
        return api;
      },
      order(field, options = {}) {
        state.order = [field, options.ascending === false ? "desc" : "asc"];
        return api;
      },
      insert(payload) {
        state.action = "insert";
        state.payload = payload;
        return api;
      },
      upsert(payload) {
        state.action = "upsert";
        state.payload = payload;
        return api;
      },
      update(payload) {
        state.action = "update";
        state.payload = payload;
        return api;
      },
      delete() {
        state.action = "delete";
        return api;
      },
      single() {
        state.returnSingle = true;
        return api;
      },
      maybeSingle() {
        state.returnSingle = true;
        state.maybeSingle = true;
        return api;
      },
      then(resolve, reject) {
        return execute().then(resolve, reject);
      },
    };

    async function matching() {
      const filteredQuery = () => {
        let query = db.collection(collection);
        state.filters.forEach(([field, value]) => {
          // Firestore document IDs are metadata, not stored fields. The app's
          // Supabase-like API exposes that metadata as `id`, so translate id
          // filters to Firestore's document-ID sentinel.
          const firestoreField =
            field === "id" ? firebase.firestore.FieldPath.documentId() : field;
          query = query.where(firestoreField, "==", value);
        });
        return query;
      };
      const rowsFrom = (snapshot) =>
        snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      let query = filteredQuery();
      if (state.order) query = query.orderBy(state.order[0], state.order[1]);
      try {
        return rowsFrom(await query.get());
      } catch (error) {
        // Equality filters plus an ordered field require a Firestore composite
        // index. Keep pages functional while a newly-created index is building.
        if (!state.order || error?.code !== "failed-precondition") throw error;
        const rows = rowsFrom(await filteredQuery().get());
        const [field, direction] = state.order;
        const multiplier = direction === "desc" ? -1 : 1;
        return rows.sort((left, right) => {
          const a = left[field] ?? null;
          const b = right[field] ?? null;
          if (a === b) return 0;
          if (a === null) return -multiplier;
          if (b === null) return multiplier;
          return (a > b ? 1 : -1) * multiplier;
        });
      }
    }

    async function execute() {
      try {
        if (state.action === "select") {
          const rows = await matching();
          return {
            data: state.returnSingle ? rows[0] || null : rows,
            error: null,
          };
        }
        if (state.action === "insert" || state.action === "upsert") {
          const input = Array.isArray(state.payload)
            ? state.payload
            : [state.payload];
          const rows = [];
          for (const item of input) {
            const id = item.id || idFor();
            const record = {
              ...item,
              created_at: item.created_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            await db
              .collection(collection)
              .doc(id)
              .set(record, { merge: state.action === "upsert" });
            rows.push({ id, ...record });
          }
          return { data: state.returnSingle ? rows[0] : rows, error: null };
        }
        const rows = await matching();
        const batch = db.batch();
        rows.forEach((row) => {
          const ref = db.collection(collection).doc(row.id);
          state.action === "delete"
            ? batch.delete(ref)
            : batch.update(ref, {
                ...state.payload,
                updated_at: new Date().toISOString(),
              });
        });
        await batch.commit();
        return {
          data: state.returnSingle ? rows[0] || null : rows,
          error: null,
        };
      } catch (error) {
        return { data: null, error };
      }
    }
    return api;
  }

  return {
    auth: {
      async getSession() {
        const user = await authStateReady;
        return {
          data: {
            session: user
              ? { user: { id: user.uid, phone: user.phoneNumber || null } }
              : null,
          },
          error: null,
        };
      },
      async getUser() {
        await authStateReady;
        const user = authInstance.currentUser;
        return {
          data: {
            user: user
              ? { id: user.uid, phone: user.phoneNumber || null }
              : null,
          },
          error: null,
        };
      },
      async signOut() {
        await authInstance.signOut();
        return { error: null };
      },
    },
    from: builder,
    storage: {
      from: () => ({
        upload: async (path, file) => {
          try {
            await storage.ref(path).put(file);
            return { error: null };
          } catch (error) {
            return { error };
          }
        },
      }),
    },
    channel: () => ({
      on() {
        return this;
      },
      subscribe() {
        return this;
      },
    }),
    removeChannel() {},
  };
}

function demoAdapter() {
  function builder(collection) {
    const state = {
      filters: [],
      order: null,
      action: "select",
      payload: null,
      returnSingle: false,
    };
    const api = {
      select() {
        return api;
      },
      eq(field, value) {
        state.filters.push([field, value]);
        return api;
      },
      order(field, options = {}) {
        state.order = [field, options.ascending === false ? -1 : 1];
        return api;
      },
      insert(payload) {
        state.action = "insert";
        state.payload = payload;
        return api;
      },
      upsert(payload) {
        state.action = "upsert";
        state.payload = payload;
        return api;
      },
      update(payload) {
        state.action = "update";
        state.payload = payload;
        return api;
      },
      delete() {
        state.action = "delete";
        return api;
      },
      single() {
        state.returnSingle = true;
        return api;
      },
      maybeSingle() {
        state.returnSingle = true;
        return api;
      },
      then(resolve, reject) {
        return execute().then(resolve, reject);
      },
    };
    function matches(row) {
      return state.filters.every(([field, value]) => row[field] === value);
    }
    async function execute() {
      try {
        let rows = demoRows(collection);
        const found = () => rows.filter(matches);
        if (state.action === "select") {
          let data = found();
          if (state.order)
            data.sort((a, b) =>
              a[state.order[0]] > b[state.order[0]]
                ? state.order[1]
                : -state.order[1],
            );
          return {
            data: state.returnSingle ? clone(data[0] || null) : clone(data),
            error: null,
          };
        }
        if (state.action === "insert" || state.action === "upsert") {
          const input = Array.isArray(state.payload)
            ? state.payload
            : [state.payload];
          const saved = [];
          input.forEach((item) => {
            const id = item.id || idFor();
            const index = rows.findIndex((row) => row.id === id);
            const row = {
              ...(index >= 0 && state.action === "upsert" ? rows[index] : {}),
              ...item,
              id,
              created_at: item.created_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            index >= 0 ? (rows[index] = row) : rows.push(row);
            saved.push(row);
          });
          saveDemoRows(collection, rows);
          return {
            data: state.returnSingle ? clone(saved[0]) : clone(saved),
            error: null,
          };
        }
        const targets = found();
        rows = rows.filter((row) => !targets.includes(row));
        if (state.action === "update") {
          rows.push(
            ...targets.map((row) => ({
              ...row,
              ...state.payload,
              updated_at: new Date().toISOString(),
            })),
          );
        }
        saveDemoRows(collection, rows);
        return {
          data: state.returnSingle ? clone(targets[0] || null) : clone(targets),
          error: null,
        };
      } catch (error) {
        return { data: null, error };
      }
    }
    return api;
  }
  return {
    auth: {
      async getSession() {
        const user = currentDemoUser();
        return { data: { session: user ? { user } : null }, error: null };
      },
      async getUser() {
        return { data: { user: currentDemoUser() }, error: null };
      },
      async signOut() {
        localStorage.removeItem("farmlink_firebase_user");
        return { error: null };
      },
    },
    from: builder,
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    channel: () => ({
      on() {
        return this;
      },
      subscribe() {
        return this;
      },
    }),
    removeChannel() {},
  };
}

window.firebaseReady = new Promise((resolve) => {
  if (!hasFirebaseConfig) {
    window.firebaseClient = demoAdapter();
    resolve(window.firebaseClient);
    return;
  }
  const scripts = [
    "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js",
    "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js",
    "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage-compat.js",
  ];
  const loadScript = (src) =>
    new Promise((resolveScript, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolveScript;
      script.onerror = () =>
        reject(new Error(`Firebase SDK failed to load: ${src}`));
      document.head.appendChild(script);
    });

  (async () => {
    try {
      await loadScript(scripts[0]);
      await Promise.all(scripts.slice(1).map(loadScript));
      firebase.initializeApp(FIREBASE_CONFIG);
      window.firebaseClient = firestoreAdapter(firebase);
      resolve(window.firebaseClient);
    } catch (error) {
      console.error(
        "Firebase initialization failed; using browser-local demo data.",
        error,
      );
      window.firebaseMode = "demo";
      window.firebaseClient = demoAdapter();
      resolve(window.firebaseClient);
    }
  })();
});

async function getCurrentUser() {
  if (window.authGuardReady && !(await window.authGuardReady))
    return { client: null, user: null };
  const client = await window.firebaseReady;
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  const user = data.user;
  if (user && !user.phone)
    user.phone = sessionStorage.getItem("farmlink_phone") || null;
  return { client, user };
}

function formatFirebaseError(error) {
  if (!error) return "Unknown Firebase error.";
  return error.message || String(error);
}

async function requestFirebasePhoneOtp(phoneNumber, containerId) {
  await window.firebaseReady;
  if (!window.firebase || !hasFirebaseConfig) {
    throw new Error("Firebase Phone Authentication is not available.");
  }

  const auth = window.firebase.auth();
  auth.languageCode = "hi";
  auth.settings.appVerificationDisabledForTesting =
    FIREBASE_USE_TEST_PHONE_AUTH;

  if (window.farmlinkRecaptchaVerifier) {
    window.farmlinkRecaptchaVerifier.clear();
  }
  window.farmlinkRecaptchaVerifier = new window.firebase.auth.RecaptchaVerifier(
    containerId,
    { size: "invisible" },
  );
  window.farmlinkPhoneConfirmation = await auth.signInWithPhoneNumber(
    phoneNumber,
    window.farmlinkRecaptchaVerifier,
  );
  return window.farmlinkPhoneConfirmation;
}

async function confirmFirebasePhoneOtp(code) {
  if (!window.farmlinkPhoneConfirmation) {
    throw new Error("पहले OTP भेजें।");
  }
  return window.farmlinkPhoneConfirmation.confirm(code);
}

async function requireVerifiedUser() {
  const { client, user } = await getCurrentUser();
  if (!user) {
    window.location.href = "../../login.html";
    return false;
  }
  const { data, error } = await client
    .from("users")
    .select("verified,role")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) return false;
  // Sellers may use the app while KYC/bank verification is pending; individual
  // screens show that status and dashboard quick actions guide completion.
  return true;
}
