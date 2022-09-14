const express = require('express');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const cors = require('cors');
const got = require('got');
const cheerio = require('cheerio');
const path = require('path');
const { Athlete } = require('./schemas/AthleteSchema');

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const readableToSeconds = (read) => {
    const [mins, secs] = read.split(':');
    return (parseFloat(mins) * 60) + (parseFloat(secs));
}

const PORT = process.env.PORT || 5001;

app.get('/', (req, res) => {
    res.send("API works!");
})

// Retrieves all the athletes for a certain school in a given season
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

app.post('/getMeetAthletes', async(req, res) => {
    const { meetId } = req.body;

    try {
        const athletes = await Athlete.find({ "results.meets.meetId": meetId});
        res.status(200).json(athletes);
    } catch (err) {
        console.log(`Failed to fetch athletes who raced at meetId=${meetId} :(`, err);
    }
});

const athletesFromResults = async(raceId, jsonToken) => {
    try {
        const response = await got.post('https://www.athletic.net/api/v1/Meet/GetResultsData', {
            json: {
                divId: raceId
            },
            headers: {
                anettokens: jsonToken
            }
        });

        const results = JSON.parse(response.body).results;
        const athletes = results.map((a) => a.AthleteID);
    return athletes;
    } catch (err) {
        console.log("Error scraping race athletes", err);
        return [];
    }
}

const getAthleteData = async(athleteId) => {
    try {
        console.log("Fetching data for athlete [", athleteId, "]...");
        const response = await got(`https://www.athletic.net/CrossCountry/Athlete.aspx?AID=${athleteId}`);
        const $ = cheerio.load(response.body);
        
        const name = $('main h2 span.mr-2').text().trim();
        const gender = $('img.mr-1').attr().src.charAt(23).toUpperCase();
        const seasons = $(`div[id*="S-"]`);
        let schoolId = "";
        let pr5k = 0;
        let athleteData = [];
        $(seasons).each((si, sel) => {
            const seasonHeader = $(sel).children().first();
            schoolId = (si == 0) ? $('a', seasonHeader).attr().href.match(/[0-9]+/)[0] : schoolId;
            const season = $(seasonHeader).text().match(/[0-9]{4}/)[0];
            const grade = $('span', seasonHeader).text();
            const raceTable = $(sel).children().last();
            let athleteResults = [];
            $('table', raceTable).each((ti, tel) => {
                const distance = $(tel).prev().text();
                if(distance === "5,000 Meters") {
                    const temppr = $('small.pr-text', tel).parent().prev().text();
                    if(temppr !== "") pr5k = readableToSeconds(temppr);
                }
                $('tr', tel).each((i, el) => {
                    const placeElement = $(el).children()[0];
                    const resultElement = $(el).children()[1];
                    const dateElement = $(el).children()[2];
                    const meetElement = $(el).children()[3];
                    const meetLink = $('a', meetElement).attr().href;
        
                    athleteResults.push({
                        place: parseInt($(placeElement).text()) || 0,
                        timeReadable: $(resultElement).text().replace(/[a-zA-Z]{2}/g, "") || "",
                        time: readableToSeconds($(resultElement).text().replace(/[a-zA-Z]{2}/g, "")) || 0,
                        distance: distance.replace(",", ""),
                        date: `${$(dateElement).text()}, ${season}`,
                        meetName: $(meetElement).text(),
                        meetId: meetLink.match(/\d+/g)[0],
                        raceId: meetLink.match(/\d+/g)[1],
                        isSR: $(resultElement).text().includes("SR") || $(resultElement).text().includes("PR"),
                        isPR: $(resultElement).text().includes("PR")
                    });
                })
            });
            if(si != 0 && (season == athleteData[athleteData.length - 1].season)) {
                athleteData[athleteData.length - 1].meets.push(...athleteResults);
            } else {
                athleteData.push({
                    season: season,
                    grade: grade,
                    meets: athleteResults
                });
            }
            
        });

        return {
            athleteId: athleteId,
            name: name,
            gender: gender,
            pr5k: pr5k,
            schoolId: schoolId,
            results: athleteData
        }
    } catch (err) {
        console.log("Error fetching athlete data:", err);
        return {};
    }
};

const saveNewAthlete = async(athleteId) => {
    const found = await Athlete.find({ athleteId: athleteId });
    if(found.length > 0) {
        console.log("Athlete [", athleteId, "] already in database");
        // If athlete already in database, update athlete results in case new meets since last scrape
        const athleteData = await getAthleteData(athleteId);
        found[0].pr5k = athleteData.pr5k;
        found[0].results = athleteData.results;
        found[0].save((err) => {
            if(err) {
                console.log("Error updating athlete [", athleteId, "]", err);
            }
        })

        return athleteData;
    } else {
        const athleteData = await getAthleteData(athleteId);
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
}

// app.get('/test', async(req, res) => {
//     // New results for Ben
//     const data = await saveNewAthlete(16555096);
//     if(data) res.status(200).json(data);
    
// })

// Retrieves all athletes that ran at a specified race directly from Athletic.net and adds to database
// Body: { meetId: 1234,ß jsonToken: "fghjkl" }
app.post('/scrapeRaceAthletes', async(req, res) => {
    const { raceId, jsonToken } = req.body;

    // Get list of athletes from 
    let athletesAdded = 0;
    let totalAthletes;
    athletesFromResults(raceId, jsonToken, raceName).then(async(athletes) => {
        console.log("-------------\nObtaining athletes from race [", raceName, "]\n-------------");
        totalAthletes = athletes.length;
        for(const aid of athletes) {
            const added = await saveNewAthlete(aid);
            if(added) {
                athletesAdded++;
            }
        }
        console.log(`Dump complete! ${athletesAdded} athletes added!`);
        res.status(200).json({ athletesAdded, totalAthletes });
    });
    
});

app.post('/scrapeMeetAthletes', async(req, res) => {
    // Use https://www.athletic.net/api/v1/Meet/GetEventListData with anettokens for whole meet to get list of races
    // Use athletesFromResults method for each race (each race has same anettokens as meet) and combine into 1 array
    // Add all to database

    const { meetId, jsonToken } = req.body;

    try {
        const response = await got('https://www.athletic.net/api/v1/Meet/GetEventListData', {
            headers: {
                anettokens: jsonToken
            }
        });

        const { events } = JSON.parse(response.body);
        
        let athletesToAdd = [];
        let athletesAdded = 0;

        for(const event of events) {
            // Limit it to events with LevelMask 4 (HS)
            if(event.LevelMask === 4) {
                const athletes = await athletesFromResults(event.IDMeetDiv, jsonToken, event.DivName);
                athletesToAdd.push(...athletes);
            }
        }

        for(const aid of athletesToAdd) {
            const added = await saveNewAthlete(aid);
            if(added) {
                athletesAdded++;
            }
        }

        console.log(`Dump complete! ${athletesAdded} athletes added!`);
        res.status(200).json({ athletesAdded, totalAthletes: athletesToAdd.length });

    } catch (err) {
        console.log("Error adding athletes from meet [", meetId, "]", err);
        res.status(500);
    }
});

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
            const added = await saveNewAthlete(aid);
    
            if(added) athletesAdded++;
        }
    
        console.log(`Dump complete! ${athletesAdded} athletes added!`);
        res.status(200).json({ athletesAdded, totalAthletes: athletesToAdd.length });
        
    } catch (err) {
        console.log("Error getting ranked athletes on team [", schoolId, "]", err);
        res.status(500);
    }

})

// Connect to database
mongoose.connect(process.env.mongoString).then(() => {
    // Intialize express server if successful
    console.log('MongoDB Connected!');
    app.listen(PORT, () => {
        console.log(`App listening on port ${PORT}...`);
    });
}).catch((err) => console.log('Error connecting to MongoDB', err));
