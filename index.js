require('dotenv').config();
const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cron = require('node-cron');
const path = require('path');

// --- 1. RENDER SERVER SETUP ---
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send("Bi'Adana Eczane Otomasyonu (08:30 Sistemi) Aktif! 🚀");
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
    console.log("✅ Firebase baglantisi kuruldu.");
} catch (error) {
    console.error("❌ Firebase Hatasi:", error.message);
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

function getTodayDateString() {
    const d = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Istanbul"}));
    return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
}

// --- 4. MAIN SYNC FUNCTION ---
async function syncDutyPharmacies() {
    console.log(`🚀 Adana geneli eczane senkronizasyonu basladi...`);
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

            console.log(`✨ ${district} guncellendi: ${pharmaciesArray.length} eczane.`);
            
        } catch (error) {
            console.error(`❌ ${district} icin hata olustu:`, error.message);
        }
        // API limitine takilmamak icin her ilce arasinda 3 saniye bekle
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    console.log("🏁 Islem tamamlandi. Tüm ilceler guncel.");
}

// --- 5. SCHEDULER (SABAH 08:30) ---
cron.schedule('30 08 * * *', () => {
    console.log("⏰ Gunluk eczane mesaisi basladi!");
    syncDutyPharmacies();
}, {
    scheduled: true,
    timezone: "Europe/Istanbul"
});

console.log("⏳ Bot uykuda... Her sabah 08:30'da otomatik calisacak.");