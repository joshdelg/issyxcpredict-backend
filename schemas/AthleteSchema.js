const mongoose = require("mongoose");

const athleteSchema = new mongoose.Schema({
    athleteId: String,
    name: String,
    gender: String,
    pr5k: Number,
    schoolId: String,
    results: [
        {
            season: String,
            grade: String,
            meets: [
                {
                    place: Number,
                    time: Number,
                    timeReadable: String,
                    date: Date,
                    meetName: String,
                    meetId: String,
                    raceId: String,
                    distance: String,
                    isSr: Boolean,
                    isPr: Boolean
                }
            ]
        }
    ]
});

const Athlete = mongoose.model('Athlete', athleteSchema);

module.exports = {
    Athlete: Athlete
};