const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const messages = document.getElementById("messages");
const searchInput = document.getElementById("searchInput");

const SUPABASE_URL = "https://mtnzybgygnuafcajwgju.supabase.co";
const SUPABASE_KEY = "sb_publishable_CDYeqgfZCPAkyN7BZ8gBoA_egLASFxj";

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let currentChat = null;
let realtimeChannels = [];

// Registration
async function signUp() {
    const username = document.getElementById("username").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if (!username || !email || password.length < 6) {
        return showAuthMessage("Enter your name, email and a password of at least 6 characters.");
    }

   const { data, error } = await db.auth.signUp({
    email,
    password,
    options: {
        data: {
            username: username
        }
    }
});

    if (error) return showAuthMessage(error.message);

    if (data.session) {
        await saveProfile(data.user, username);
        await startApp(data.user);
    } else {
        showAuthMessage("Check your email to confirm your account, then log in.");
    }
}

// Login
async function signIn() {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    const { data, error } = await db.auth.signInWithPassword({
        email,
        password
    });

    if (error) return showAuthMessage(error.message);

    await startApp(data.user);
}

function showAuthMessage(message) {
    document.getElementById("authMessage").textContent = message;
}

// Save profile
async function saveProfile(user, username) {
    const { error } = await db.from("profiles").upsert({
        id: user.id,
        username
    });

    if (error) console.error(error);
}

// Start website

async function startApp(user) {
    currentUser = user;

    document.getElementById("authBox").style.display = "none";
    document.querySelector(".app").style.display = "flex";

    const { data: profile, error } = await db
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .maybeSingle();

    if (error) {
        console.error("Profile error:", error.message);
    }

    if (!profile) {
        await saveProfile(
            user,
            user.user_metadata?.username || user.email.split("@")[0]
        );
    }

    document.querySelector(".profile h3").textContent =
        profile?.username ||
        user.user_metadata?.username ||
        user.email;

    await loadContacts();
}


// Load registered users
async function loadContacts() {
    const { data, error } = await db
        .from("profiles")
        .select("id, username")
        .neq("id", currentUser.id)
        .order("username");

    if (error) {
        console.error(error);
        return;
    }

    const contacts = document.getElementById("contacts");
    contacts.innerHTML = "";

    data.forEach(person => {
        const contact = document.createElement("div");
        contact.className = "contact";
        
        const avatar = document.createElement("div");
        avatar.className = "avatar purple";
        avatar.textContent = person.username[0].toUpperCase();

        const info = document.createElement("div");
        info.className = "contact-info";

        const name = document.createElement("h4");
        name.textContent = person.username;

        const preview = document.createElement("p");
        preview.textContent = "Start a conversation";

        info.append(name, preview);
        contact.append(avatar, info);

        contact.addEventListener("click", () => {
            selectChat(person);
        });

        contacts.appendChild(contact);
    });
}

// Select a conversation
async function selectChat(person) {
    currentChat = person.id;

    document.getElementById("chatName").textContent =
        person.username;

    document.getElementById("chatAvatar").textContent =
        person.username[0].toUpperCase();

    document.querySelectorAll(".contact").forEach(contact => {
        contact.classList.toggle(
            "active",
            contact.querySelector("h4").textContent === person.username
        );
    });

    await loadMessages();
    subscribeMessages();
}

// Load previous messages
async function loadMessages() {
    messages.innerHTML = '<div class="date-label">Today</div>';

    const { data, error } = await db
        .from("messages")
        .select("*")
        .or(
            `and(sender_id.eq.${currentUser.id},receiver_id.eq.${currentChat}),and(sender_id.eq.${currentChat},receiver_id.eq.${currentUser.id})`
        )
        .order("created_at");

    if (error) {
        console.error(error);
        return;
    }

    data.forEach(msg => {
        addMessage(
            msg.content,
            msg.sender_id === currentUser.id ? "sent" : "received"
        );
    });
}

// Send a real message
messageForm.addEventListener("submit", async function(e) {
    e.preventDefault();

    const text = messageInput.value.trim();

    if (!text || !currentChat) return;

    messageInput.value = "";

    const { error } = await db.from("messages").insert({
        sender_id: currentUser.id,
        receiver_id: currentChat,
        content: text
    });

    if (error) {
        alert(error.message);
        messageInput.value = text;
    }
});

// Display message
function addMessage(text, type) {
    const message = document.createElement("div");
    message.className = `message ${type}`;

    const paragraph = document.createElement("p");
    paragraph.textContent = text;

    const time = document.createElement("span");
    time.textContent = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });

    message.append(paragraph, time);
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
}

// Listen for new messages
function subscribeMessages() {
    realtimeChannels.forEach(channel => db.removeChannel(channel));
    realtimeChannels = [];

    const filter = (column, id, label) => {
        const channel = db
            .channel(label)
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "messages",
                    filter: `${column}=eq.${id}`
                },
                payload => {
                    const msg = payload.new;

                    if (
                        msg.sender_id === currentChat &&
                        msg.receiver_id === currentUser.id
                    ) {
                        addMessage(msg.content, "received");
                    } else if (
                        msg.sender_id === currentUser.id &&
                        msg.receiver_id === currentChat
                    ) {
                        addMessage(msg.content, "sent");
                    }
                }
            )
            .subscribe();

        realtimeChannels.push(channel);
    };

    filter("sender_id", currentUser.id, "sent-messages");
    filter("receiver_id", currentUser.id, "received-messages");
}

// Search contacts
searchInput.addEventListener("input", function() {
    const search = this.value.toLowerCase();

    document.querySelectorAll(".contact").forEach(contact => {
        const name = contact.querySelector("h4").textContent.toLowerCase();
        contact.style.display = name.includes(search) ? "flex" : "none";
    });
});

// Emoji
document.getElementById("emojiBtn").addEventListener("click", () => {
    messageInput.value += " 😊";
    messageInput.focus();
});

// Restore existing login
async function initializeApp() {
    const { data: { session } } = await db.auth.getSession();

    if (session) {
        await startApp(session.user);
    }
}

initializeApp();
