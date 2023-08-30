const got = require('got');

const config = require('../config');

// Fetches data from athlete bio page and formats it ready for database upload
const getAthleteDataNew = async(athleteId) => {
    // Construct URL and get raw bio data
    const url = config.templateUrls.athleteBioApi.replace('$athleteId', athleteId);
    
    console.log(`Fetching new data from athlete: ${athleteId} at ${url}`);

    const response = await got(url);
    const bioData = JSON.parse(response.body);

    // Calculate results array [{season, grade (written), meets: [{place, time, timeReadable, date, meetName, meetid, raceId, distance}]}]
    // Info separated between list of Meets and list of Results
    // Create map meetId -> meetData. Iterate over each result and use result.meetId to map result data to meet data
    // Divide meet + result data into correct season bucket
    
    // For tracking
    let pr5k = -1;

    // Set up template map for results from each season
    let seasonResults = {};    
    let seasonToGrade = {};
    
    Object.entries(bioData.grades).forEach(([key, val]) => {
        season = key.split('_')[1];
        grade = val.toString() + "th Grade";

        seasonToGrade[season] = grade;
        
        seasonResults[season] = {
            season: season,
            grade: grade,
            meets: []
        };
    });

    // Create map of every meetId -> meetData
    let allMeets = bioData.meets;

    // Iterate through all results and map them back to meets using meetId
    bioData.resultsXC.forEach(resultObj => {
        const meetId = resultObj.MeetID;

        if(resultObj.PersonalBest && resultObj.Distance == 5000) pr5k = resultObj.SortValue;

        const newResultsData = {
            place: resultObj.Place,
            time: resultObj.SortValue,
            timeReadable: resultObj.Result,
            raceId: "Can't find :(",
            distance: resultObj.Distance,
            season: resultObj.SeasonID,
            grade: seasonToGrade[resultObj.SeasonID]
        }

        allMeets[meetId] = {
            ...allMeets[meetId],
            ...newResultsData
        }
    });
    
    // Iterate through all meetData and place in correct season
    Object.entries(allMeets).forEach(([meetId, meetData]) => {
        seasonResults[meetData.season].meets.push({
            place: meetData.place,
            time: meetData.time,
            timeReadable: meetData.timeReadable,
            date: meetData.EndDate,
            meetName: meetData.MeetName,
            meetId: meetId,
            raceId: meetData.raceId,
            distance: meetData.distance,
        });
    });

    // Conform to existing schema by turning season map into array and sort by date
    let results = Object.entries(seasonResults).map(([season, seasonResult]) => {
        seasonResult.meets.sort((meetA, meetB) => ((new Date(meetA.date)).getTime() - (new Date(meetB.date)).getTime()));
        return seasonResult;
    });
    
    // Construct rest of athlete data
    let athleteData = {
        athleteId: athleteId,
        name: bioData.athlete.FirstName + " " + bioData.athlete.LastName,
        gender: bioData.athlete.Gender,
        pr5k: pr5k,
        schoolId: bioData.athlete.SchoolID.toString(),
        results: results
    };

    return athleteData;
};

// Returns a list of athleteIds from the given race
const athletesFromResults = async(raceId, jsonToken) => {
    try {
        const response = await got.post('https://www.athletic.net/api/v1/Meet/GetResultsData', {
            json: {
                divId: raceId
            },
            headers: {
                Anettokens: jsonToken
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

module.exports = {
    getAthleteDataNew: getAthleteDataNew,
    athletesFromResults: athletesFromResults
};