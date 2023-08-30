const { Athlete } = require('../schemas/AthleteSchema');

const scrapers = require('./scrapers');

// Helper function which takes in athleteID and updates it if already found ad adds it if not
// TODO please make it so that it finds only one lol. Actually refactor this whole thing you can probably just save it either way lol
const saveNewAthlete = async(athleteId) => {
    try {
        const found = await Athlete.find({ athleteId: athleteId });
        const athleteData = await scrapers.getAthleteDataNew(athleteId);
        
        // Found -> update athlete results in case new meets since last scrape. Not Found -> Add new athlete
        if(found.length > 0) {
            console.log("Athlete [", athleteId, "] already in database");

            found[0].pr5k = athleteData.pr5k;
            found[0].results = athleteData.results;
            found[0].save((err) => {
                if(err) {
                    console.log("Error updating athlete [", athleteId, "]", err);
                    return null;
                }
            })

            return athleteData;
        } else {
            if(athleteData.athleteId) {
                const athlete = new Athlete({...athleteData});
                athlete.save((err) => {
                    if(err) {
                        console.log("Error saving athlete [", athleteId, "]", err);
                        return null;
                    }
                });
            }
            return athleteData;
        }
    } catch (err) {
        console.log("Error saving athlete " + athleteId + "Error: " + err);
        return {};
    }
}

module.exports = {
    saveNewAthlete: saveNewAthlete
}