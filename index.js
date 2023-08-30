const express = require('express');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const cors = require('cors');
const got = require('got');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');

const { Athlete } = require('./schemas/AthleteSchema');

const config = require('./config');
const scrapers = require('./lib/scrapers');
const db = require('./lib/db');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

const readableToSeconds = (read) => {
    const [mins, secs] = read.split(':');
    return (parseFloat(mins) * 60) + (parseFloat(secs));
}

app.get('/', (req, res) => {
    res.send("API works!");
})

// ! DEPRECATED. Switch to new URL
// Retrieves all the athletes for a certain school in a given season already contained in DB
// Body: { schoolId: 408, season: 2021}
app.post('/getSchoolAthletes', async(req, res) => {
    const { schoolId, season } = req.body; 

    try {
        const athletes = await Athlete.find({ schoolId: schoolId, "results.season": season });
        res.status(200).json(athletes);
    } catch (err) {
        console.log(`Failed to fetch athlete data for schoolId=${schoolId} and season=${season}: `, err);
    }

})

// ? Works successfully!
// Fetches athletes in DB associated with a school during a particular season
app.get('/Athletes/School/:schoolId/:season', async(req, res) => {
    const { schoolId, season } = req.params;

    try {
        const athletes = await Athlete.find({schoolId: schoolId, "results.season": season});

        if(athletes.length === 0) {
            res.status(404).send(`No athletes were found from School ${schoolId} and Season ${season}`);
        } else {
            res.status(200).json(athletes);
        }
    } catch (err) {
        console.log(`Failed to fetch athletes from School ${schoolId} and Season ${season}. Error: ${err}`);
        res.status(500);
    }
})

// ! Deprecated. Switch to new route
app.post('/getMeetAthletes', async(req, res) => {
    const { meetId } = req.body;

    try {
        const athletes = await Athlete.find({ "results.meets.meetId": meetId});
        res.status(200).json(athletes);
    } catch (err) {
        console.log(`Failed to fetch athletes who raced at meetId=${meetId} :(`, err);
    }
});

// ? Works successfully!
// Fetches athletes from database that ran at a specified meet
app.get('/Athletes/Meet/:meetId', async(req, res) => {
    
    const { meetId } = req.params;

    console.log("Requesting athletes in DB from meet ", meetId);

    try {
        const athletes = await Athlete.find({ "results.meets.meetId": meetId});
        console.log(`Found ${athletes.length} athletes`);

        if(athletes.length === 0) {
            res.status(404).send(`No athletes were found from meet ${meetId}`);
        } else {
            res.status(200).json(athletes);
        }
    } catch (err) {
        console.log(`Failed to fetch athletes who raced at meet ${meetId}. Error: ${err}`);
    }
});

// Retrieves all athletes that ran at a specified race directly from Athletic.net and adds to database
// Body: { meetId: 1234, jsonToken: "fghjkl" }
// ? Works!
app.post('/scrapeRaceAthletes', async(req, res) => {
    const { raceId, jsonToken } = req.body;

    // Get list of athletes from 
    let athletesAdded = 0;
    let totalAthletes;
    scrapers.athletesFromResults(raceId, jsonToken).then(async(athletes) => {
        console.log("-------------\nObtaining athletes from race [", raceId, "]\n-------------");
        totalAthletes = athletes.length;
        for(const aid of athletes) {
            const added = await db.saveNewAthlete(aid);
            if(added) {
                athletesAdded++;
            }
        }
        console.log(`Dump complete! ${athletesAdded} athletes added!`);
        res.status(200).json({ athletesAdded, totalAthletes });
    });
});

// Adds to DB every athlete that ran in every race of a given meet
// Uses https://www.athletic.net/api/v1/Meet/GetEventListData with anettokens for whole meet to get list of races
// Use athletesFromResults method for each race (each race has same anettokens as meet) and combine into 1 array, adds all to DB
// Body: { meetId: 1234, jsonToken: "fghjkl" }
// ! Will need to switch this to getMeetData, each race needs own anettokens now. May have to go race by race
// ! But now there is get all results data! 
// app.post('/scrapeMeetAthletes', async(req, res) => {

//     const { meetId, jsonToken } = req.body;

//     try {
//         const response = await got('https://www.athletic.net/api/v1/Meet/GetEventListData', {
//             headers: {
//                 anettokens: jsonToken
//             }
//         });

//         const { events } = JSON.parse(response.body);
        
//         let athletesToAdd = [];
//         let athletesAdded = 0;

//         for(const event of events) {
//             // Limit it to events with LevelMask 4 (HS)
//             if(event.LevelMask === 4) {
//                 const athletes = await scrapers.athletesFromResults(event.IDMeetDiv, jsonToken, event.DivName);
//                 athletesToAdd.push(...athletes);
//             }
//         }

//         for(const aid of athletesToAdd) {
//             const added = await db.saveNewAthlete(aid);
//             if(added) {
//                 athletesAdded++;
//             }
//         }

//         console.log(`Dump complete! ${athletesAdded} athletes added!`);
//         res.status(200).json({ athletesAdded, totalAthletes: athletesToAdd.length });

//     } catch (err) {
//         console.log("Error adding athletes from meet [", meetId, "]", err);
//         res.status(500);
//     }
// });

// Add to DB every athlete that ran in every race of a given meet. Requires anettokens from GetAllResultsData
// ? Functions!
app.post('/scrapeMeetAthletes', async(req, res) => {
    // Use GetAllResultsData route to get JSON of every result of meet (all races)
    const { meetId, jsonToken } = req.body;

    try {
        const response = await got('https://www.athletic.net/api/v1/Meet/GetAllResultsData', {
            headers: {
                Anettokens: jsonToken
            }
        })

        const { results } = JSON.parse(response.body);

        // Add athletes to database
        athletesAdded = 0;

        for(const result of results) {
            // Skip if DNS or DNF
            if(result.Result != "DNS" && result.Result != "DNF") {
                const added = await db.saveNewAthlete(result.AthleteID);
                
                if(added) {
                    athletesAdded++;
                } else {
                    console.log(`Error adding athlete ${aid} :(`);
                }
            }
        }

        console.log(`Dump complete! ${athletesAdded} athletes added!`);
        res.status(200).json({ athletesAdded, totalAthletes: results.length });
    } catch (err) {
        console.log("Failed to request all results for meet " + meetId + "Error: " + err);
        res.status(500);
    }
})

// Adds to DB data for each athlete part of a given school in a given season
// Body: { schoolId: 408, season: 2021 }
// ? Functions corrcetly! Should use a set but whatever lol
app.post('/scrapeSchoolAthletes', async(req, res) => {
    const { schoolId, season } = req.body;

    try {
        const response = await got('https://www.athletic.net/CrossCountry/seasonbest', {
            searchParams: {
                SchoolID: schoolId,
                S: season
            }
        });
        const $ = cheerio.load(response.body);
        
        let teamAthletes = {
            men: [],
            women: []
        };
        
        $('div.distance').each((i, el) => {
            const menList = $('div#M_', el);
            const womenList = $('div#F_', el);
            
            $('tr', menList).each((ii, runner) => {
                const athleteId = $(runner).children().eq(2).children().first().attr().href.match(/[0-9]+/)[0];
                if(!teamAthletes.men.find((a) => a == athleteId)) teamAthletes.men.push(athleteId);
            });
            
            $('tr', womenList).each((ii, runner) => {
                const athleteId = $(runner).children().eq(2).children().first().attr().href.match(/[0-9]+/)[0];
                if(!teamAthletes.women.find((a) => a == athleteId)) teamAthletes.women.push(athleteId);
            });
        });
        
        const athletesToAdd = [...teamAthletes.men, ...teamAthletes.women];
        let athletesAdded = 0;
    
        for(const aid of athletesToAdd) {
            const added = await db.saveNewAthlete(aid);
    
            if(added) athletesAdded++;
        }
    
        console.log(`Dump complete! ${athletesAdded} athletes added!`);
        res.status(200).json({ athletesAdded, totalAthletes: athletesToAdd.length });
        
    } catch (err) {
        console.log("Error getting ranked athletes on team [", schoolId, "]", err);
        res.status(500);
    }
})

app.post('/toCSV', (req, res) => {

    const { data, stat } = req.body;

    let content = stat == "time" ? "Avg. Time,Predicted Time\n" : "Time,SR\n";
    data.forEach(line => {
        content += `${line[0]},${line[1]}\n`
    })
    const filePath = stat == 'time' ? './outputs/time.csv' : './outputs/sr.csv';

    fs.writeFileSync(filePath, content, { flag: 'w+' }, err => console.log(`Error writing CSV: ${err}`));
})

// Connect to database
mongoose.connect(process.env.mongoString).then(() => {
    // Intialize express server if successful
    console.log('MongoDB Connected!');
    app.listen(PORT, () => {
        console.log(`App listening on port ${PORT}...`);
    });
}).catch((err) => console.log('Error connecting to MongoDB', err));
