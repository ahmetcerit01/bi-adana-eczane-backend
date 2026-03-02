require('dotenv').config();
const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cron = require('node-cron');

// --- 1. RENDER DUMMY SERVER ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send("Bi'Adana Eczane Botu Aktif ve Çalışıyor! 🚀");
});

app.listen(PORT, () => {
    console.log(`✅ Sunucu ${PORT} portunda dinleniyor. Render deploy hatası çözüldü!`);
});

// --- 2. FIREBASE SETUP ---
try {
    const serviceAccount = require('./serviceAccountKey.json');
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

// --- 4. FUNCTIONS ---
function normalizeName(name) {
    return name.toLowerCase()
        .replace(/ eczanesi/gi, '')
        .replace(/ ecz\./gi, '')
        .replace(/ ecz/gi, '')
        .trim();
}

async function resetDutyStatuses() {
    console.log("🧹 Resetting current duty statuses...");
    const dutySnapshot = await db.collection('places')
        .where('categoryId', '==', 'eczane')
        .where('isOnDuty', '==', true)
        .get();

    if (dutySnapshot.empty) return;

    const batch = db.batch();
    dutySnapshot.forEach(doc => {
        batch.update(doc.ref, { isOnDuty: false });
    });
    await batch.commit();
    console.log(`✅ Successfully reset ${dutySnapshot.size} pharmacies.`);
}

async function syncDutyPharmacies() {
    await resetDutyStatuses();
    console.log(`🚀 Starting sync job...`);

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

            for (const pharmacy of apiList) {
                const searchName = normalizeName(pharmacy.pharmacyName);
                const placeQuery = await db.collection('places')
                    .where('categoryId', '==', 'eczane')
                    .where('name', '>=', pharmacy.pharmacyName.split(' ')[0])
                    .get();

                if (!placeQuery.empty) {
                    const bestMatch = placeQuery.docs.find(doc => {
                        const dbName = doc.data().name.toLowerCase();
                        const dbDistrict = doc.data().district.toLowerCase();
                        return dbName.includes(searchName) && dbDistrict.includes(district.toLowerCase().replace('ü','u').replace('ç','c'));
                    }) || placeQuery.docs[0];

                    await bestMatch.ref.update({
                        isOnDuty: true,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                    console.log(`✨ SET ON DUTY: ${bestMatch.data().name} (${district})`);
                } else {
                    console.warn(`⚠️ Not found: ${pharmacy.pharmacyName}`);
                }
            }
        } catch (error) {
            console.error(`❌ API Error for ${district}:`, error.message);
        }
        // API rate limit'e takılmamak için kısa bir bekleme
        await new Promise(resolve => setTimeout(resolve, 1200));
    }
    
    console.log("🏁 Daily sync completed.");
}

// --- 5. SCHEDULER ---
cron.schedule('30 08 * * *', () => {
    syncDutyPharmacies();
});

console.log("⏳ Background worker active. Waiting for 08:30 AM scheduler...");
syncDutyPharmacies();