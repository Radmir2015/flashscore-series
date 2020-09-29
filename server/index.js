const path = require('path')
const express = require('express')
const app = express()
const io = require('socket.io')(3001)
const port = 3000

const Flashscore = require('./parser')

app.get('/', async (req, res) => {
    res.sendFile(path.join(__dirname + '/views/index.html'))
})

let flash = null
let leagues = null

io.on('connect', async socket => {
    console.log('New connection')
    try {
        console.log(`Browser is opened: ${!!flash}, leagues are parsed: ${!!leagues}`)
        console.log(leagues)
        if (!flash) {
            flash = flash || new Flashscore()
            await flash.run()
            
            leagues = await flash.getLeagues()

            socket.emit('leagues', leagues)
        } else {
            if (leagues === null || leagues.length === 0) leagues = await flash.getLeagues()
            console.log('leagues bool', leagues.length > 0)
            socket.emit('leagues', leagues)
        }

        socket.on('stop', async () => { await flash.driver.quit(); flash = null } )

        socket.on('start-find-series', async (leagueIndex, filterOptions, analizeOptions) => {
            console.log('Starting series search...', leagueIndex)
            socket.emit('found-series',
                await flash.findSeriesForLeague(leagueIndex, filterOptions, analizeOptions, (match) => {
                    // add new element to the table
                    console.log('match', match)
                    socket.emit('new-element', match)
                }, (key, stage, inc, total) => {
                    console.log(key, stage, inc, total)
                    socket.emit('stats', key, stage, inc, total)
                })
            )
        })

        socket.on('start-find-historical', async (matchUrl, filterOptions, analizeOptions) => {
            socket.emit('found-historical-series',
                await flash.goToTeamPages(matchUrl, filterOptions, analizeOptions, (matches) => {
                        console.log('Sent new historical element', matches)
                        socket.emit('new-element-historical', matches)
                    }, (key, stage, inc, total, notIncrementally) => {
                        console.log(key, stage, inc, total, notIncrementally)
                        socket.emit('stats', key, stage, inc, total, notIncrementally)
                    }
                ))
        })
    } catch (e) {
        console.error(e)
        if (flash)
            await flash.driver.quit()
    }
})


app.listen(port, () => {
    console.log(`Server is listening at http://localhost:${port}`)
})