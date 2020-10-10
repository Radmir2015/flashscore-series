const admin = require('firebase-admin')

const firebaseConfig = process.env.SERVICE_ACCOUNT ? JSON.parse(process.env.SERVICE_ACCOUNT) : require('../service-account-key.json')

// Initialize Firebase
admin.initializeApp({
    credential: admin.credential.cert(firebaseConfig),
    databaseURL: "https://flashscore-point.firebaseio.com"
})
// admin.analytics()

const db = admin.firestore()
db.settings({ ignoreUndefinedProperties: true })

module.exports = { db }