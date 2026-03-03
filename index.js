require('dotenv').config();
const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cron = require('node-cron');
const path = require('path');

// --- 1. RENDER DUMMY SERVER ---
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send("Bi'Adana Eczane Botu (5 DK TEST + TÜRKİYE SAATİ) Aktif! 🚀");
});

app.listen(PORT, () => {
    console.log(`✅ Sunucu ${PORT} portunda dinleniyor.`);
});

// --- 2. FIREBASE SETUP ---
try {
    const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("✅ Firebase initialized successfully.");
} catch (error) {
    console.error("❌ CRITICAL ERROR: 'serviceAccountKey.json' not found!");
    process.exit(1);
}

const db = admin.firestore();

// --- 3. CONFIGURATION ---
const CITY = 'Adana';
const DISTRICTS = [
    'Seyhan', 'Yüreğir', 'Çukurova', 'Sarıçam', 'Ceyhan', 
    'Kozan', 'İmamoğlu', 'Karataş', 'Karaisalı', 'Pozantı', 
    'Yumurtalık', 'Tufanbeyli', 'Feke', 'Aladağ', 'Saimbeyli'
];

function normalizeDistrictId(district) {
    return district.toLowerCase()
        .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
        .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u') + '_today';
}

// 🇹🇷 TÜRKİYE SAATİNE GÖRE BUGÜNÜN TARİHİNİ AL (RENDER AMERİKA'DA OLSA BİLE)
function getTodayDateString() {
    const d = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Istanbul"}));
    return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
}

// --- 4. MAIN SYNC FUNCTION ---
async function syncDutyPharmacies() {
    console.log(`🚀 Starting sync job...`);
    const dateStr = getTodayDateString();

    for (const district of DISTRICTS) {
        try {
            const options = {
                method: 'GET',
                url: 'https://nobetci-eczane-api-turkiye.p.rapidapi.com/pharmacies-on-duty',
                params: { district, city: CITY },
                headers: {
                    'X-RapidAPI-Key': process.env.RAPID_API_KEY,
                    'X-RapidAPI-Host': 'nobetci-eczane-api-turkiye.p.rapidapi.com'
                }
            };

            const response = await axios.request(options);
            const apiList = response.data.data || response.data.result || [];

            const pharmaciesArray = apiList.map(p => ({
                name: p.pharmacyName || "",
                address: p.address || "",
                phone: p.phone || "",
                directions: p.directions || "",
                latitude: parseFloat(p.latitude) || 0,
                longitude: parseFloat(p.longitude) || 0
            }));

            const docId = normalizeDistrictId(district);

            await db.collection('eczaneler').doc(docId).set({
                date: dateStr,
                districtName: district,
                pharmacies: pharmaciesArray
            });

            console.log(`✨ UPDATED: ${docId} -> ${pharmaciesArray.length} eczane eklendi. (Tarih: ${dateStr})`);
            
        } catch (error) {
            console.error(`❌ API Error for ${district}:`, error.message);
        }
        await new Promise(resolve => setTimeout(resolve, 1200));
    }
    
    console.log("🏁 Daily sync completed. Otomasyon bitti.");
}

// --- 5. SCHEDULER (5 DAKİKALIK TEST MODU + TÜRKİYE SAAT DİLİMİ) ---
cron.schedule('*/5 * * * *', () => {
    console.log("⏱️ 5 dakikalık test tetiklendi!");
    syncDutyPharmacies();
}, {
    scheduled: true,
    timezone: "Europe/Istanbul"
});

console.log("⏳ Background worker active. Waiting for 5-minute scheduler...");
// Bot ilk açıldığında da hemen bir kere çalışsın:
syncDutyPharmacies();