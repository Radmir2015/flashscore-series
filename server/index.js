const path = require('path')
const express = require('express')
const app = express()
// const io = require('socket.io')(3001)
const port = process.env.PORT || 3000
const db = require('../db').db

const Flashscore = require('./parser')

const status = { parsing: false }
let matches = {}

const parseProcess = async () => {
    try {
        status.parsing = true
        await checkBrowser()
        await flash.fillingDatabase((key, stage, inc, total, notIncrementally) => {
            console.log(key, stage, inc, total)
            if (!status[key]) {
                status[key] = { stage: stage, current: inc, total: total }
            } else {
                if (status[key].stage - 1 !== stage) status[key].current = 0
                status[key].stage = stage + 1
    
                if (notIncrementally) status[key].current = inc
                else status[key].current += inc
    
                status[key].total = total
            }
            // socket.emit('stats', key, stage, inc, total)
        }, {
            assign: (key, obj) => matches[key] = obj,
            push: (key, element) => matches[key].push(element),
            matches
        })
        status.parsing = false
    } catch (err) {
        console.log(err)
        status.parsing = false
        setTimeout(async () => await parseProcess(), 10000)
    }
}

app.get('/', async (req, res) => {
    res.sendFile(path.join(__dirname + '/views/index.html'))
})

app.get('/start', async (req, res) => {
    if (!status.parsing) {
        await parseProcess()
    }
    res.status(200).json({ status: 'ok', browserIsOn: !!flash, leaguesParsed: leagues && leagues.length > 0, parsing: status.parsing })
})

app.get('/status', async (req, res) => {
    await checkBrowser()
    res.status(200).json({ ...status, matches })
})

app.get('/matches', async (req, res) => {
    if (matches[0].length > 0)
        res.status(200).json(matches[0])
    else {
        const today = new Date()
        today.setHours(0, 0, 0, 0)

        let matchesInDb = await db.collection('current').where('date', '==', today).get()
        if (!matchesInDb.empty) {
            matchesInDb = matchesInDb.docs.map(x => x.data())
            matches[0] = matchesInDb
        }
        res.status(200).json(matches[0])
    }
})

let flash = null
let leagues = null

// io.on('connect', async socket => {
//     console.log('New connection')
//     try {
//         console.log(`Browser is opened: ${!!flash}, leagues are parsed: ${!!leagues}`)
//         console.log(leagues)
//         if (!flash) {
//             flash = flash || new Flashscore()
//             await flash.run()
            
//             leagues = await flash.getLeagues()
//             socket.emit('leagues', leagues)

//         } else {
//             if (leagues === null || leagues.length === 0) leagues = await flash.getLeagues()
//             console.log('leagues bool', leagues.length > 0)
//             socket.emit('leagues', leagues)
//         }

//         socket.on('stop', async () => { await flash.driver.quit(); flash = null } )

//         socket.on('start-find-series', async (leagueIndex, filterOptions, analizeOptions) => {
//             console.log('Starting series search...', leagueIndex)
//             await flash.fillingDatabase((key, stage, inc, total) => {
//                 console.log(key, stage, inc, total)
//                 socket.emit('stats', key, stage, inc, total)
//             })
//             // socket.emit('found-series',
//             //     await flash.findSeriesForLeague(leagueIndex, filterOptions, analizeOptions, (match) => {
//             //         // add new element to the table
//             //         console.log('match', match)
//             //         socket.emit('new-element', match)
//             //     }, (key, stage, inc, total) => {
//             //         console.log(key, stage, inc, total)
//             //         socket.emit('stats', key, stage, inc, total)
//             //     })
//             // )
//         })

//         socket.on('start-find-historical', async (matchUrl, filterOptions, analizeOptions) => {
//             socket.emit('found-historical-series',
//                 await flash.goToTeamPages(matchUrl, filterOptions, analizeOptions, (matches) => {
//                         console.log('Sent new historical element', matches)
//                         socket.emit('new-element-historical', matches)
//                     }, (key, stage, inc, total, notIncrementally) => {
//                         console.log(key, stage, inc, total, notIncrementally)
//                         socket.emit('stats', key, stage, inc, total, notIncrementally)
//                     }
//                 ))
//         })
//     } catch (e) {
//         console.error(e)
//         if (flash)
//             await flash.driver.quit()
//     }
// })

const checkBrowser = async () => {
    try {
        console.log(`Browser is opened: ${!!flash}, leagues are parsed: ${!!leagues}`)
        console.log(leagues)
        if (!flash) {
            flash = flash || new Flashscore()
            await flash.run()
            leagues = await flash.getLeagues()
            console.log('I\'m fucking ready!')
        } else {
            if (leagues === null || leagues.length === 0) leagues = await flash.getLeagues()
            console.log('I\'m fucking ready!')
        }
    } catch (e) {
        console.error(e)
        if (flash)
            await flash.driver.quit()
    }
}

app.listen(port, async () => {
    console.log(`Server is listening at http://localhost:${port}`)

    if (!status.parsing) {
        await parseProcess()
    }
})