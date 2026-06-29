const STORAGE_KEY = "prismHavenSubmissions";
const BLOG_STORAGE_KEY = "prismHavenBlogPosts";
const AUTH_STORAGE_KEY = "prismHavenCurrentUser";

let supabaseClient = null;
let currentUserCache = null;
let submissionsCache = [];
let blogPostsCache = [];

function hasSupabaseConfig() {
  const config = window.PRISM_HAVEN_SUPABASE || {};
  return Boolean(
    window.supabase &&
    config.url &&
    config.anonKey &&
    !config.url.includes("YOUR_SUPABASE_URL") &&
    !config.anonKey.includes("YOUR_SUPABASE_ANON_KEY")
  );
}

function getSupabaseClient() {
  if (!hasSupabaseConfig()) return null;
  if (!supabaseClient) {
    const config = window.PRISM_HAVEN_SUPABASE;
    supabaseClient = window.supabase.createClient(config.url, config.anonKey);
  }
  return supabaseClient;
}

function readLocalJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
}

function saveLocalJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getSubmissions() {
  return submissionsCache.length ? submissionsCache : readLocalJson(STORAGE_KEY);
}

function getBlogPosts() {
  return blogPostsCache.length ? blogPostsCache : readLocalJson(BLOG_STORAGE_KEY);
}

function getCurrentUser() {
  if (currentUserCache) return currentUserCache;
  try {
    return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveCurrentUser(user) {
  currentUserCache = user;
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
}

function clearCurrentUser() {
  currentUserCache = null;
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

function isAuthor(user = getCurrentUser()) {
  return user?.role === "author";
}

function pathFor(page) {
  const isPagesPath = window.location.pathname.includes("/pages/");
  return isPagesPath ? page : `pages/${page}`;
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initialsFor(name) {
  return String(name || "Author")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "A";
}

function readFileAsDataUrl(file) {
  if (!file) return Promise.resolve("");

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function mapBookRow(row) {
  const profile = row.profiles || {};
  return {
    id: row.id,
    writer: profile.pen_name || row.author_name || "Anonymous Author",
    authorPhoto: row.author_photo_url || profile.avatar_url || "",
    title: row.title,
    submissionType: row.submission_type,
    bookGenre: row.book_genre,
    lgbtqCategory: row.lgbtq_category,
    readerFilter: row.reader_filter,
    storyTags: row.story_tags || [],
    body: row.body,
    createdAt: row.created_at
  };
}

function mapBlogPostRow(row) {
  const comments = row.post_comments || [];
  const topLevelComments = comments
    .filter((comment) => !comment.parent_id)
    .map((comment) => ({
      id: comment.id,
      author: comment.author_name,
      body: comment.body,
      createdAt: comment.created_at,
      replies: comments
        .filter((reply) => reply.parent_id === comment.id)
        .map((reply) => ({
          id: reply.id,
          author: reply.author_name,
          body: reply.body,
          createdAt: reply.created_at
        }))
    }));

  return {
    id: row.id,
    author: row.author_name,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    comments: topLevelComments
  };
}

async function loadCurrentUser() {
  const client = getSupabaseClient();
  if (!client) {
    currentUserCache = null;
    return;
  }

  const { data: userData } = await client.auth.getUser();
  const authUser = userData?.user;
  if (!authUser) {
    clearCurrentUser();
    return;
  }

  const { data: profile } = await client
    .from("profiles")
    .select("id, pen_name, role, avatar_url")
    .eq("id", authUser.id)
    .maybeSingle();

  saveCurrentUser({
    id: authUser.id,
    name: profile?.pen_name || authUser.user_metadata?.pen_name || authUser.email,
    email: authUser.email,
    role: profile?.role || authUser.user_metadata?.role || "reader",
    avatarUrl: profile?.avatar_url || "",
    signedInAt: new Date().toISOString()
  });
}

async function loadSubmissions() {
  const client = getSupabaseClient();
  if (!client) {
    submissionsCache = readLocalJson(STORAGE_KEY);
    return;
  }

  const { data, error } = await client
    .from("books")
    .select("*, profiles:author_id(pen_name, avatar_url)")
    .eq("publication_status", "published")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    submissionsCache = [];
    return;
  }

  submissionsCache = (data || []).map(mapBookRow);
}

async function loadBlogPosts() {
  const client = getSupabaseClient();
  if (!client) {
    blogPostsCache = readLocalJson(BLOG_STORAGE_KEY);
    return;
  }

  const { data, error } = await client
    .from("community_posts")
    .select("*, post_comments(*)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    blogPostsCache = [];
    return;
  }

  blogPostsCache = (data || []).map(mapBlogPostRow);
}

async function uploadAuthorPhoto(file, user) {
  const client = getSupabaseClient();
  if (!client || !file || !file.size) return "";

  const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
  const path = `${user.id}/${Date.now()}-${safeName}`;
  const { error } = await client.storage.from("author-avatars").upload(path, file, { upsert: true });
  if (error) throw error;

  const { data } = client.storage.from("author-avatars").getPublicUrl(path);
  return data.publicUrl;
}

async function saveSubmission(submission, photoFile) {
  const client = getSupabaseClient();
  if (!client) {
    const submissions = readLocalJson(STORAGE_KEY);
    submissions.unshift(submission);
    saveLocalJson(STORAGE_KEY, submissions);
    submissionsCache = submissions;
    return;
  }

  const user = getCurrentUser();
  const authorPhotoUrl = await uploadAuthorPhoto(photoFile, user);
  if (authorPhotoUrl) {
    await client.from("profiles").update({ avatar_url: authorPhotoUrl }).eq("id", user.id);
  }

  const { error } = await client.from("books").insert({
    author_id: user.id,
    title: submission.title,
    submission_type: submission.submissionType,
    book_genre: submission.bookGenre,
    lgbtq_category: submission.lgbtqCategory || null,
    reader_filter: submission.readerFilter,
    story_tags: submission.storyTags,
    body: submission.body,
    author_photo_url: authorPhotoUrl || user.avatarUrl || null,
    publication_status: "published"
  });

  if (error) throw error;
  await loadSubmissions();
}

function setupAuthNavigation() {
  const user = getCurrentUser();
  const nav = document.querySelector("nav");
  if (!nav) return;

  const submitLink = [...nav.querySelectorAll("a")].find((link) => link.getAttribute("href")?.endsWith("submit.html"));
  if (submitLink) {
    submitLink.hidden = !isAuthor(user);
  }

  let signinLink = [...nav.querySelectorAll("a")].find((link) => link.getAttribute("href")?.endsWith("signin.html"));
  if (!signinLink) {
    signinLink = document.createElement("a");
    signinLink.href = pathFor("signin.html");
    nav.append(signinLink);
  }

  const existingSignOut = nav.querySelector(".signout-button");
  if (existingSignOut) existingSignOut.remove();

  if (!user) {
    signinLink.textContent = "Sign In";
    signinLink.href = pathFor("signin.html");
    signinLink.removeAttribute("aria-label");
    return;
  }

  signinLink.textContent = `${user.role === "author" ? "Author" : "Reader"}: ${user.name}`;
  signinLink.href = pathFor("signin.html");
  signinLink.setAttribute("aria-label", `Signed in as ${user.name}`);

  const signOutButton = document.createElement("button");
  signOutButton.className = "signout-button";
  signOutButton.type = "button";
  signOutButton.textContent = "Sign Out";
  signOutButton.addEventListener("click", async () => {
    const client = getSupabaseClient();
    if (client) await client.auth.signOut();
    clearCurrentUser();
    window.location.href = pathFor("signin.html");
  });
  nav.append(signOutButton);
}

function setupSigninForm() {
  const form = document.querySelector("#signinForm");
  if (!form) return;

  const currentUser = getCurrentUser();
  const params = new URLSearchParams(window.location.search);
  const requestedRole = params.get("role");
  const status = document.querySelector("#signinStatus");
  const modeInputs = form.querySelectorAll('input[name="authMode"]');

  const updateMode = () => {
    const mode = new FormData(form).get("authMode") || "signup";
    const isSignup = mode === "signup";
    form.querySelectorAll("[data-signup-only]").forEach((item) => {
      item.hidden = !isSignup;
      item.querySelectorAll("input").forEach((input) => {
        input.disabled = !isSignup;
      });
    });
    form.querySelector(".auth-submit-label").textContent = isSignup ? "Create Account" : "Sign In";
  };

  if (currentUser) {
    form.elements.displayName.value = currentUser.name || "";
    form.elements.email.value = currentUser.email || "";
    const roleInput = form.querySelector(`input[name="role"][value="${currentUser.role}"]`);
    if (roleInput) roleInput.checked = true;
  }

  if (requestedRole === "author" || requestedRole === "reader") {
    const roleInput = form.querySelector(`input[name="role"][value="${requestedRole}"]`);
    if (roleInput) roleInput.checked = true;
  }

  modeInputs.forEach((input) => input.addEventListener("change", updateMode));
  updateMode();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const mode = data.get("authMode") || "signup";
    const user = {
      name: String(data.get("displayName") || "").trim(),
      email: String(data.get("email") || "").trim(),
      role: data.get("role"),
      signedInAt: new Date().toISOString()
    };
    const password = String(data.get("password") || "");
    const client = getSupabaseClient();

    if (!user.email || !password || (mode === "signup" && (!user.name || !user.role))) {
      status.textContent = "Please complete every required field before continuing.";
      return;
    }

    if (password.length < 8) {
      status.textContent = "Please use a password with at least 8 characters.";
      return;
    }

    status.textContent = mode === "signup" ? "Creating your account..." : "Signing you in...";

    if (!client) {
      saveCurrentUser(user);
      status.textContent = "Demo sign-in saved in this browser. Add Supabase keys before launch.";
      window.location.href = user.role === "author" ? "submit.html" : "books.html";
      return;
    }

    const authResponse = mode === "signup"
      ? await client.auth.signUp({
        email: user.email,
        password,
        options: { data: { pen_name: user.name, role: user.role } }
      })
      : await client.auth.signInWithPassword({ email: user.email, password });

    if (authResponse.error) {
      status.textContent = authResponse.error.message;
      return;
    }

    await loadCurrentUser();
    const signedInUser = getCurrentUser();
    status.textContent = mode === "signup"
      ? "Account created. Check your email if Supabase asks you to confirm it."
      : "Signed in.";
    window.location.href = signedInUser?.role === "author" ? "submit.html" : "books.html";
  });
}

function renderAuthorGate(layout, user) {
  const signinHref = pathFor("signin.html?role=author");
  const booksHref = pathFor("books.html");
  const message = user?.role === "reader"
    ? "You are signed in as a Reader. Reader accounts can browse and read published stories, but they cannot publish books or chapters."
    : "Please sign in as an Author to publish books or chapters on Prism Haven.";

  layout.innerHTML = `
    <article class="locked-panel">
      <p class="section-kicker">Author Access Required</p>
      <h2>Publishing is only available to Author accounts.</h2>
      <p>${message}</p>
      <div class="actions">
        <a class="button primary" href="${signinHref}">Sign In as Author</a>
        <a class="button secondary" href="${booksHref}">Explore Stories</a>
      </div>
    </article>
  `;
}

function metaTagsFor(item) {
  const tags = Array.isArray(item.storyTags) ? item.storyTags : [];
  return [
    item.bookGenre || item.genre || "General",
    item.lgbtqCategory,
    item.readerFilter,
    item.submissionType || item.type || "Submission",
    ...tags
  ].filter(Boolean);
}

function renderCommunityShelf() {
  const shelf = document.querySelector("#communityShelf");
  if (!shelf) return;

  const submissions = getSubmissions();
  if (submissions.length === 0) {
    shelf.innerHTML = `
      <article class="empty-state">
        <h3>The Community Shelf is waiting.</h3>
        <p>Books, chapters, and serial updates published from the submission page will appear here.</p>
        <a class="button secondary" href="${pathFor("submit.html")}">Submit the first chapter</a>
      </article>
    `;
    return;
  }

  shelf.innerHTML = submissions.map((item) => {
    const bookGenre = item.bookGenre || item.genre || "General";
    const lgbtqCategory = item.lgbtqCategory || "";
    const storyTags = Array.isArray(item.storyTags) ? item.storyTags : [];
    const readerFilter = item.readerFilter || "Recently Updated";
    const submissionType = item.submissionType || item.type || "Submission";
    const meta = metaTagsFor({ ...item, bookGenre, readerFilter, submissionType });

    return `
      <article class="work-card"
        data-genre="${escapeText(bookGenre)}"
        data-lgbtq="${escapeText(lgbtqCategory)}"
        data-tags="${escapeText(storyTags.join("|"))}"
        data-status="${escapeText(readerFilter)}">
        <div class="work-meta">
          ${meta.map((tag) => `<span>${escapeText(tag)}</span>`).join("")}
        </div>
        <h3>${escapeText(item.title)}</h3>
        <p class="byline">By ${escapeText(item.writer)}</p>
        <p>${escapeText(item.body).replaceAll("\n", "<br>")}</p>
      </article>
    `;
  }).join("");
}

function setupGenreFilters() {
  const filterButtons = document.querySelectorAll(".genre-filter");
  if (filterButtons.length === 0) return;

  const status = document.querySelector("#filterStatus");
  const applyFilter = (filterType, filterValue) => {
    const cards = document.querySelectorAll(".work-card");
    let visibleCount = 0;

    cards.forEach((card) => {
      let matches = filterType === "all";
      if (filterType === "genre") matches = card.dataset.genre === filterValue;
      if (filterType === "lgbtq") matches = card.dataset.lgbtq === filterValue;
      if (filterType === "status") matches = card.dataset.status === filterValue;
      if (filterType === "tag") {
        const tags = (card.dataset.tags || "").split("|");
        matches = tags.includes(filterValue);
      }

      card.hidden = !matches;
      if (matches) visibleCount += 1;
    });

    filterButtons.forEach((button) => {
      const isActive = button.dataset.filterType === filterType && button.dataset.filterValue === filterValue;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    if (status) {
      status.textContent = filterType === "all"
        ? `Showing all ${visibleCount} library entries.`
        : `Showing ${visibleCount} result${visibleCount === 1 ? "" : "s"} for ${filterValue}.`;
    }
  };

  filterButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.classList.contains("is-active")));
    button.addEventListener("click", () => applyFilter(button.dataset.filterType, button.dataset.filterValue));
  });

  applyFilter("all", "All");
}

function renderAuthors() {
  const authorsGrid = document.querySelector("#authorsGrid");
  if (!authorsGrid) return;

  const submissions = getSubmissions();
  if (submissions.length === 0) {
    authorsGrid.innerHTML = `
      <article class="empty-state">
        <h3>No community authors yet.</h3>
        <p>Author profiles will appear here when writers publish books or chapters.</p>
        <a class="button secondary" href="${pathFor("signin.html?role=author")}">Join as an Author</a>
      </article>
    `;
    return;
  }

  const authors = new Map();
  submissions.forEach((item) => {
    const name = item.writer || "Anonymous Author";
    const current = authors.get(name) || {
      name,
      photo: "",
      books: [],
      genres: new Set()
    };

    if (item.authorPhoto) current.photo = item.authorPhoto;
    current.books.push(item.title);
    current.genres.add(item.bookGenre || item.genre || "General");
    authors.set(name, current);
  });

  authorsGrid.innerHTML = [...authors.values()].map((author) => {
    const genres = [...author.genres];
    const latestTitle = author.books[0] || "Untitled";
    const avatar = author.photo
      ? `<img src="${author.photo}" alt="${escapeText(author.name)} profile picture">`
      : `<span>${escapeText(initialsFor(author.name))}</span>`;

    return `
      <article class="author-card">
        <div class="author-avatar">${avatar}</div>
        <div>
          <h3>${escapeText(author.name)}</h3>
          <p>${author.books.length} published entr${author.books.length === 1 ? "y" : "ies"} on Prism Haven.</p>
          <p class="byline">Latest: ${escapeText(latestTitle)}</p>
          <div class="work-meta">
            ${genres.map((genre) => `<span>${escapeText(genre)}</span>`).join("")}
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function setupSubmissionForm() {
  const form = document.querySelector("#submissionForm");
  if (!form) return;

  const user = getCurrentUser();
  const layout = document.querySelector(".submit-layout");
  if (!isAuthor(user)) {
    if (layout) renderAuthorGate(layout, user);
    return;
  }

  if (form.elements.writer && user?.name) {
    form.elements.writer.value = user.name;
  }

  const status = document.querySelector("#formStatus");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isAuthor()) {
      status.textContent = "Only Author accounts can publish books or chapters.";
      return;
    }

    const data = new FormData(form);
    const photoFile = data.get("authorPhoto");
    const storyTags = data.getAll("storyTags");

    const submission = {
      writer: data.get("writer").trim(),
      authorPhoto: !getSupabaseClient() && photoFile && photoFile.size ? await readFileAsDataUrl(photoFile) : "",
      title: data.get("title").trim(),
      submissionType: data.get("submissionType"),
      bookGenre: data.get("bookGenre"),
      lgbtqCategory: data.get("lgbtqCategory"),
      readerFilter: data.get("readerFilter"),
      storyTags,
      body: data.get("body").trim(),
      createdAt: new Date().toISOString()
    };

    if (!submission.writer || !submission.title || !submission.submissionType || !submission.bookGenre || !submission.readerFilter || !submission.body) {
      status.textContent = "Please complete every required field before publishing.";
      return;
    }

    try {
      status.textContent = "Publishing...";
      await saveSubmission(submission, photoFile);
      form.reset();
      if (form.elements.writer && user?.name) form.elements.writer.value = user.name;
      status.textContent = getSupabaseClient()
        ? "Published. Your submission is now stored in Supabase."
        : "Published. Your submission is now in the Library and Authors page on this browser.";
      renderCommunityShelf();
      renderAuthors();
      setupGenreFilters();
    } catch (error) {
      console.error(error);
      status.textContent = error.message || "Something went wrong while publishing.";
    }
  });
}

function renderBlogFeed() {
  const feed = document.querySelector("#blogFeed");
  if (!feed) return;

  const posts = getBlogPosts();
  if (posts.length === 0) {
    feed.innerHTML = `
      <article class="empty-state">
        <h3>No community posts yet.</h3>
        <p>Start the first conversation in the Prism Haven community blog.</p>
      </article>
    `;
    return;
  }

  feed.innerHTML = posts.map((post) => `
    <article class="blog-post" data-post-id="${escapeText(post.id)}">
      <div class="blog-post-header">
        <div class="author-avatar compact"><span>${escapeText(initialsFor(post.author))}</span></div>
        <div>
          <h3>${escapeText(post.title)}</h3>
          <p class="byline">Posted by ${escapeText(post.author)}</p>
        </div>
      </div>
      <p>${escapeText(post.body).replaceAll("\n", "<br>")}</p>

      <form class="comment-form" data-post-id="${escapeText(post.id)}">
        <input name="commentAuthor" type="text" placeholder="Your name" value="${escapeText(getCurrentUser()?.name || "")}" required />
        <textarea name="commentBody" rows="3" placeholder="Add a comment..." required></textarea>
        <button class="button secondary" type="submit">Comment</button>
      </form>

      <div class="comment-list">
        ${(post.comments || []).map((comment) => `
          <div class="comment-item" data-comment-id="${escapeText(comment.id)}">
            <p><strong>${escapeText(comment.author)}</strong> ${escapeText(comment.body)}</p>
            <form class="reply-form" data-post-id="${escapeText(post.id)}" data-comment-id="${escapeText(comment.id)}">
              <input name="replyAuthor" type="text" placeholder="Your name" value="${escapeText(getCurrentUser()?.name || "")}" required />
              <input name="replyBody" type="text" placeholder="Reply..." required />
              <button class="text-button" type="submit">Reply</button>
            </form>
            <div class="reply-list">
              ${(comment.replies || []).map((reply) => `
                <p class="reply-item"><strong>${escapeText(reply.author)}</strong> ${escapeText(reply.body)}</p>
              `).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    </article>
  `).join("");
}

async function saveBlogPost(post) {
  const client = getSupabaseClient();
  if (!client) {
    const posts = readLocalJson(BLOG_STORAGE_KEY);
    posts.unshift(post);
    saveLocalJson(BLOG_STORAGE_KEY, posts);
    blogPostsCache = posts;
    return;
  }

  const user = getCurrentUser();
  const { error } = await client.from("community_posts").insert({
    author_id: user?.id || null,
    author_name: post.author,
    title: post.title,
    body: post.body
  });
  if (error) throw error;
  await loadBlogPosts();
}

async function saveComment(postId, comment, parentId = null) {
  const client = getSupabaseClient();
  if (!client) {
    const posts = readLocalJson(BLOG_STORAGE_KEY);
    const post = posts.find((item) => item.id === postId);
    if (!post) return;

    if (parentId) {
      const parent = post.comments?.find((item) => item.id === parentId);
      if (!parent) return;
      parent.replies = parent.replies || [];
      parent.replies.push(comment);
    } else {
      post.comments = post.comments || [];
      post.comments.push({ ...comment, replies: [] });
    }

    saveLocalJson(BLOG_STORAGE_KEY, posts);
    blogPostsCache = posts;
    return;
  }

  const user = getCurrentUser();
  const { error } = await client.from("post_comments").insert({
    post_id: postId,
    parent_id: parentId,
    author_id: user?.id || null,
    author_name: comment.author,
    body: comment.body
  });
  if (error) throw error;
  await loadBlogPosts();
}

function setupCommunityBlog() {
  const form = document.querySelector("#blogPostForm");
  const feed = document.querySelector("#blogFeed");
  if (!form || !feed) return;

  const status = document.querySelector("#blogStatus");
  const currentUser = getCurrentUser();
  if (currentUser && form.elements.postAuthor) {
    form.elements.postAuthor.value = currentUser.name;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const post = {
      id: createId("post"),
      author: data.get("postAuthor").trim(),
      title: data.get("postTitle").trim(),
      body: data.get("postBody").trim(),
      comments: [],
      createdAt: new Date().toISOString()
    };

    if (!post.author || !post.title || !post.body) {
      status.textContent = "Please complete every field before posting.";
      return;
    }

    try {
      await saveBlogPost(post);
      form.reset();
      if (currentUser && form.elements.postAuthor) form.elements.postAuthor.value = currentUser.name;
      status.textContent = "Posted to the community blog.";
      renderBlogFeed();
    } catch (error) {
      console.error(error);
      status.textContent = error.message || "Something went wrong while posting.";
    }
  });

  feed.addEventListener("submit", async (event) => {
    const commentForm = event.target.closest(".comment-form");
    const replyForm = event.target.closest(".reply-form");
    if (!commentForm && !replyForm) return;

    event.preventDefault();

    try {
      if (commentForm) {
        const data = new FormData(commentForm);
        const comment = {
          id: createId("comment"),
          author: data.get("commentAuthor").trim(),
          body: data.get("commentBody").trim(),
          replies: [],
          createdAt: new Date().toISOString()
        };

        if (!comment.author || !comment.body) return;
        await saveComment(commentForm.dataset.postId, comment);
        renderBlogFeed();
      }

      if (replyForm) {
        const data = new FormData(replyForm);
        const reply = {
          id: createId("reply"),
          author: data.get("replyAuthor").trim(),
          body: data.get("replyBody").trim(),
          createdAt: new Date().toISOString()
        };

        if (!reply.author || !reply.body) return;
        await saveComment(replyForm.dataset.postId, reply, replyForm.dataset.commentId);
        renderBlogFeed();
      }
    } catch (error) {
      console.error(error);
    }
  });
}

async function initPrismHaven() {
  await loadCurrentUser();
  await Promise.all([loadSubmissions(), loadBlogPosts()]);
  renderCommunityShelf();
  setupGenreFilters();
  renderAuthors();
  setupSubmissionForm();
  renderBlogFeed();
  setupCommunityBlog();
  setupSigninForm();
  setupAuthNavigation();
}

document.addEventListener("DOMContentLoaded", initPrismHaven);
