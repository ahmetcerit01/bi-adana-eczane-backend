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
    res.send("Bi'Adana Eczane Botu (Yeni Mimari - Test Modu) Aktif! 🚀");
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

// Doküman ID'sini oluşturmak için Türkçe karakterleri temizleyen fonksiyon (Örn: Çukurova -> cukurova_today)
function normalizeDistrictId(district) {
    return district.toLowerCase()
        .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
        .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u') + '_today';
}

// Bugünün tarihini "DD.MM.YYYY" formatında al
function getTodayDateString() {
    const d = new Date();
    return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
}

// --- 4. MAIN SYNC FUNCTION ---
async function syncDutyPharmacies() {
    console.log(`🚀 Starting sync job with NEW ARCHITECTURE...`);
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

            // API'den gelen veriyi Firebase'deki (resimde attığın) yapıya uygun hale getiriyoruz
            const pharmaciesArray = apiList.map(p => ({
                name: p.pharmacyName || "",
                address: p.address || "",
                phone: p.phone || "",
                directions: p.directions || "",
                latitude: parseFloat(p.latitude) || 0,
                longitude: parseFloat(p.longitude) || 0
            }));

            const docId = normalizeDistrictId(district);

            // Eczaneler koleksiyonundaki ilgili ilçe dokümanını komple eziyoruz/güncelliyoruz
            await db.collection('eczaneler').doc(docId).set({
                date: dateStr,
                districtName: district,
                pharmacies: pharmaciesArray
            });

            console.log(`✨ UPDATED: ${docId} -> ${pharmaciesArray.length} eczane eklendi.`);
            
        } catch (error) {
            console.error(`❌ API Error for ${district}:`, error.message);
        }
        await new Promise(resolve => setTimeout(resolve, 1200));
    }
    
    console.log("🏁 Daily sync completed. Otomasyon bitti.");
}

// --- 5. SCHEDULER (TEST MODU) ---
// TEST İÇİN: Her 5 dakikada bir çalışacak şekilde ayarlandı (*/5 * * * *)
cron.schedule('*/5 * * * *', () => {
    console.log("⏱️ 5 dakikalık test tetiklendi!");
    syncDutyPharmacies();
});

console.log("⏳ Background worker active. Waiting for 5-minute scheduler...");
// Bot ilk açıldığında da hemen bir kere çalışsın:
syncDutyPharmacies();