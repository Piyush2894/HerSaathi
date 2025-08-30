// --- FIREBASE IMPORTS ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- DOM ELEMENTS ---
const landingPage = document.getElementById('landing-page');
const appContainer = document.getElementById('app-container');
const getStartedBtn = document.getElementById('get-started-btn');
const homeLogoBtnDesktop = document.getElementById('home-logo-btn-desktop');
const homeLogoBtnMobile = document.getElementById('home-logo-btn-mobile');
const pages = document.querySelectorAll('.page');
const allNavButtons = document.querySelectorAll('.nav-btn');
const mainInput = document.getElementById('main-input');
const addBtn = document.getElementById('add-btn');
const micBtn = document.getElementById('mic-btn');
const activityFeed = document.getElementById('activity-feed');
const chatFeed = document.getElementById('chat-feed');
const expenseSummary = document.getElementById('expense-summary');
const moodSummary = document.getElementById('mood-summary');
const alertBox = document.getElementById('alert-box');
const translatorInput = document.getElementById('translator-input');
const translateBtn = document.getElementById('translate-btn');
const translatorOutput = document.getElementById('translator-output');
const userInitialMobile = document.getElementById('user-initial-mobile');
const userInitialDesktop = document.getElementById('user-initial-desktop');
const settingsUserInitial = document.getElementById('settings-user-initial');
const userIdDisplay = document.getElementById('user-id-display');
const userIdDisplayDesktop = document.getElementById('user-id-display-desktop');
const dataStatus = document.getElementById('data-status');

// --- FIREBASE CONFIG ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- INITIALIZE SERVICES ---
let app, auth, db;
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
} catch (e) {
    console.error("Firebase initialization failed:", e);
    if(dataStatus) dataStatus.textContent = 'Config Error';
}

// --- APP STATE & REFERENCES ---
let currentUser = null;
let activitiesCollectionRef;
let unsubscribeActivities = null;

// --- GEMINI API CONFIG ---
const GEMINI_API_KEY = "";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;

// --- NAVIGATION & PAGE LOGIC ---
function showLandingPage() {
    landingPage.style.display = 'block';
    appContainer.style.display = 'none';
}

getStartedBtn.addEventListener('click', () => {
    landingPage.style.display = 'none';
    appContainer.style.display = 'block';
    if (!auth.currentUser) {
         if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            signInWithCustomToken(auth, __initial_auth_token).catch(error => signInAnonymously(auth));
        } else {
            signInAnonymously(auth);
        }
    }
});

homeLogoBtnDesktop.addEventListener('click', showLandingPage);
homeLogoBtnMobile.addEventListener('click', showLandingPage);

// --- AUTHENTICATION ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        const initial = currentUser.uid.substring(0, 1).toUpperCase();
        [userInitialMobile, userInitialDesktop, settingsUserInitial].forEach(el => el.textContent = initial);
        userIdDisplay.textContent = `User ID: ${currentUser.uid}`;
        userIdDisplayDesktop.textContent = `ID: ${currentUser.uid.substring(0,10)}...`;
        dataStatus.textContent = 'Connected';
        
        activitiesCollectionRef = collection(db, 'artifacts', appId, 'users', currentUser.uid, 'activities');
        listenForActivities();
    }
});

// --- FIRESTORE DATA LISTENER ---
function listenForActivities() {
    if (unsubscribeActivities) unsubscribeActivities();
    const q = query(activitiesCollectionRef, orderBy('timestamp', 'desc'));
    unsubscribeActivities = onSnapshot(q, (snapshot) => {
        const activities = snapshot.docs.map(doc => doc.data());
        processActivities(activities);
    }, (error) => {
        console.error("Firestore listener error:", error);
        dataStatus.textContent = 'Sync Error';
    });
}

// --- DATA PROCESSING ---
function processActivities(activities) {
    activityFeed.innerHTML = '<p class="text-center text-gray-400">No recent activities.</p>';
    chatFeed.innerHTML = '<p class="text-center text-gray-400">Your conversation starts here.</p>';

    if(activities.length > 0) {
        activityFeed.innerHTML = '';
        chatFeed.innerHTML = '';
    }

    let expenseData = {};
    let moodHistory = [];
    
    const chronologicalActivities = [...activities].reverse();
    chronologicalActivities.forEach(activity => {
        renderActivityToFeed(activity, chatFeed);
    });
    
    activities.forEach(activity => {
         renderActivityToFeed(activity, activityFeed, 3);
    });

    activities.forEach(activity => {
        if (activity.type === 'expense' && activity.details) {
            expenseData[activity.details.category] = (expenseData[activity.details.category] || 0) + activity.details.amount;
        }
        if (activity.type === 'mood' && activity.details && activity.timestamp) {
            const moodMap = { happy: 5, excited: 5, calm: 4, tired: 2, sad: 1, angry: 1 };
            const day = activity.timestamp.toDate().toLocaleDateString('en-US', { weekday: 'short' });
            moodHistory.push({ day, moodValue: moodMap[activity.details.emotion] || 3, emotion: activity.details.emotion });
        }
    });

    updateExpenseSummary(expenseData);
    updateMoodSummary(moodHistory);
    updateExpenseChart(expenseData);
    updateMoodChart(moodHistory);
    checkMoodPatterns(moodHistory, activities);
}

// --- GEMINI API FUNCTIONS ---
async function callGemini(prompt, schema = null) {
    const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
    if (schema) {
        payload.generationConfig = { responseMimeType: "application/json", responseSchema: schema };
    }
    const response = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`API error: ${response.statusText}`);
    const result = await response.json();
    if (!result.candidates?.[0]?.content?.parts?.[0]) throw new Error('Invalid API response');
    return result.candidates[0].content.parts[0].text;
}

async function processInputWithGemini(text) {
    if (!currentUser) { showAlert("Connecting..."); return; }
    setLoading(addBtn, true, 'send');
    const prompt = `Analyze this Hinglish text from a user: "${text}". Classify intent ('expense', 'task', 'mood', 'other') and extract details. For mood, use one of: 'happy', 'sad', 'tired', 'calm', 'angry', 'excited'. For expense, use one category: 'Groceries', 'Transport', 'Bills', 'Shopping', 'Food', 'Other'. Respond ONLY with a valid JSON object.`;
    const schema = { type: "OBJECT", properties: { "intent": { "type": "STRING" }, "category": { "type": "STRING" }, "amount": { "type": "NUMBER" }, "task_description": { "type": "STRING" }, "emotion": { "type": "STRING" } }, required: ["intent"] };
    
    try {
        await addDoc(activitiesCollectionRef, { type: 'user', text, timestamp: serverTimestamp() });
        const jsonText = await callGemini(prompt, schema);
        await handleApiResponse(JSON.parse(jsonText));
    } catch (error) {
        console.error("Error processing input:", error);
        showAlert("Sorry, I couldn't understand that.");
    } finally {
        setLoading(addBtn, false, 'send');
    }
}
async function translateToHindi(englishText) {
     if (!englishText) return;
    setLoading(translateBtn, true, 'translate');
    const prompt = `Translate to Hindi: "${englishText}"`;
    try {
        translatorOutput.textContent = await callGemini(prompt);
        translatorOutput.classList.remove('hidden');
    } catch (error) {
        console.error("Translation error:", error);
        showAlert("Translation failed.");
    } finally {
        setLoading(translateBtn, false, 'translate');
    }
}
async function getProactiveSuggestion(reason) {
    showAlert("HerSaathi has a thought for you...", "info");
    const prompt = `A user of a women's wellness app in India seems to be repeatedly sad on Sundays. Write a short, gentle, proactive, and caring message in Hinglish to check in on them. Reason: ${reason}.`;
    try {
        const suggestion = await callGemini(prompt);
        await addDoc(activitiesCollectionRef, { type: 'ai_suggestion', text: suggestion, icon: '💖', timestamp: serverTimestamp() });
    } catch (error) {
        console.error("Proactive suggestion error:", error);
    }
}

async function handleApiResponse(data) {
    const { intent, category, amount, task_description, emotion } = data;
    let responseActivity = { type: 'note', text: "I've made a note of that.", icon: '📝', timestamp: serverTimestamp() };

    switch (intent) {
        case 'expense':
            if (amount && category) responseActivity = { type: 'expense', text: `Got it. Added ₹${amount} to ${category}.`, icon: '💸', details: { category, amount }, timestamp: serverTimestamp() };
            break;
        case 'task':
            if (task_description) responseActivity = { type: 'task', text: `Reminder set: "${task_description}"`, icon: '✅', details: { task_description }, timestamp: serverTimestamp() };
            break;
        case 'mood':
             if (emotion) responseActivity = { type: 'mood', text: `Thanks for sharing that you're feeling ${emotion}.`, icon: getEmojiForMood(emotion), details: { emotion }, timestamp: serverTimestamp() };
            break;
    }
    await addDoc(activitiesCollectionRef, responseActivity);
}

// --- UI & LOGIC ---
function renderActivityToFeed(activity, feed, limit = null) {
    if (limit && feed.childElementCount >= limit) {
        return;
    }
    const isChat = feed.id === 'chat-feed';
    const alignment = (activity.type === 'user' || activity.type === 'ai_suggestion') ? 'items-end' : 'items-start';
    const bubbleColor = (activity.type === 'user') ? 'bg-soft-pink' : 'bg-gray-100';
    const icon = activity.icon || (activity.type === 'user' ? '👩' : '🤖');

    const activityEl = document.createElement('div');
    activityEl.className = `flex w-full flex-col mb-4 ${isChat ? alignment : 'items-start'}`;
    
    if (isChat) {
         activityEl.innerHTML = `<div class="p-3 rounded-2xl max-w-md ${bubbleColor}"><p class="text-gray-700">${activity.text}</p></div>`;
    } else {
         activityEl.innerHTML = `<div class="flex items-start space-x-3"><div class="w-8 h-8 rounded-full bg-light-pink flex-shrink-0 flex items-center justify-center text-lg">${icon}</div><p class="font-medium text-gray-700">${activity.text}</p></div>`;
    }
    
    if(limit) feed.prepend(activityEl);
    else feed.append(activityEl);
    feed.scrollTop = feed.scrollHeight;
}

function checkMoodPatterns(moodHistory, allActivities) {
    const alreadySuggested = allActivities.some(a => a.type === 'ai_suggestion');
    if (alreadySuggested) return;

    const today = new Date().toLocaleDateString('en-US', { weekday: 'short' });
    const sadDays = moodHistory.filter(m => (m.emotion === 'sad' || m.emotion === 'tired') && m.day === today);
    if (sadDays.length >= 2) {
        getProactiveSuggestion(`User has logged feeling sad/tired on ${today} multiple times.`);
    }
}
function updateExpenseSummary(expenseData) {
    const total = Object.values(expenseData).reduce((a, b) => a + b, 0);
    expenseSummary.textContent = `₹${total}`;
}
function updateMoodSummary(moodHistory) {
    const lastMood = moodHistory[moodHistory.length - 1];
    if (!lastMood) {
        moodSummary.textContent = '---';
        return;
    };
    moodSummary.textContent = lastMood.emotion.charAt(0).toUpperCase() + lastMood.emotion.slice(1);
}
function getEmojiForMood(emotion) {
    return { happy: '😊', sad: '😔', tired: '😴', calm: '😌', angry: '😠', excited: '🎉' }[emotion] || '💖';
}
function setLoading(button, isLoading, type) {
    button.disabled = isLoading;
    if (type === 'send') {
        button.innerHTML = isLoading ? '<div class="spinner mx-auto"></div>' : '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7"></path></svg>';
    } else if (type === 'translate') {
        button.innerHTML = isLoading ? '<div class="spinner mx-auto"></div>' : '<span>Translate</span>';
    }
}
function showAlert(message, type = 'success') {
    alertBox.textContent = message;
    alertBox.className = `fixed top-5 right-5 text-white py-3 px-5 rounded-lg shadow-xl transform transition-transform duration-500 ease-in-out translate-x-0 ${type === 'info' ? 'bg-blue-500' : 'bg-accent'}`;
    setTimeout(() => { alertBox.classList.add('translate-x-[120%]'); }, 3500);
}

// --- CHARTS ---
let expensePieChart, moodLineChart;
function createCharts() { 
     const expenseCtx = document.getElementById('expense-pie-chart').getContext('2d');
    expensePieChart = new Chart(expenseCtx, {
        type: 'doughnut',
        data: { labels: [], datasets: [{ data: [], backgroundColor: ['#FFB6C1', '#FF69B4', '#DB7093', '#C71585', '#FF1493', '#8B008B'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
    });
    const moodCtx = document.getElementById('mood-line-chart').getContext('2d');
    moodLineChart = new Chart(moodCtx, {
        type: 'line',
        data: { labels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], datasets: [{ label: 'Mood', data: [], borderColor: '#FF69B4', tension: 0.4, fill: true, backgroundColor: 'rgba(255, 105, 180, 0.1)' }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 1, max: 5, display: false }, x: { grid: { display: false } } }, plugins: { legend: { display: false } } }
    });
}
function updateExpenseChart(expenseData) {
    if(!expensePieChart) return;
    expensePieChart.data.labels = Object.keys(expenseData);
    expensePieChart.data.datasets[0].data = Object.values(expenseData);
    expensePieChart.update();
}
function updateMoodChart(moodHistory) {
    if(!moodLineChart) return;
    const week = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const moodData = week.map(day => {
        const dayMoods = moodHistory.filter(m => m.day === day);
        return dayMoods.length ? dayMoods[dayMoods.length - 1].moodValue : null;
    });
    moodLineChart.data.datasets[0].data = moodData;
    moodLineChart.update();
}

// --- EVENT LISTENERS ---
addBtn.addEventListener('click', () => {
    const text = mainInput.value.trim();
    if (text && !addBtn.disabled) {
        processInputWithGemini(text);
        mainInput.value = '';
    }
});
mainInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addBtn.click(); });
translateBtn.addEventListener('click', () => translateToHindi(translatorInput.value.trim()));

// --- VOICE INPUT ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.lang = 'hi-IN';
    micBtn.addEventListener('click', () => { micBtn.classList.add('animate-pulse'); recognition.start(); });
    recognition.onresult = (e) => mainInput.value = e.results[0][0].transcript;
    recognition.onend = () => { micBtn.classList.remove('animate-pulse'); setTimeout(() => { if(mainInput.value) addBtn.click(); }, 300); };
    recognition.onerror = () => { micBtn.classList.remove('animate-pulse'); showAlert("Sorry, I couldn't hear that."); };
} else { micBtn.style.display = 'none'; }

// --- INITIAL RENDER ---
window.onload = () => {
    setLoading(addBtn, false, 'send');
    setLoading(translateBtn, false, 'translate');
    createCharts();
};

// --- NAVIGATION ---
allNavButtons.forEach(button => {
    button.addEventListener('click', () => {
        const targetPageId = button.dataset.page;
        pages.forEach(page => page.classList.remove('active'));
        document.getElementById(targetPageId).classList.add('active');

        allNavButtons.forEach(btn => {
            btn.classList.remove('text-accent', 'bg-light-pink', 'font-semibold');
            btn.classList.add('text-gray-500');
        });
        
        document.querySelectorAll(`.nav-btn[data-page="${targetPageId}"]`).forEach(activeBtn => {
            activeBtn.classList.add('text-accent', 'font-semibold');
            if(activeBtn.parentElement.id === 'nav-buttons-desktop') {
                activeBtn.classList.add('bg-light-pink');
            }
        });
    });
});
