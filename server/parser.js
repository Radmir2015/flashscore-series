const { Builder, By, Key, until, Capabilities } = require('selenium-webdriver')
// const firefox = require('selenium-webdriver/firefox')
const chrome = require('selenium-webdriver/chrome')

const { performance } = require('perf_hooks')
const db = require('../db').db

class FlashScore {
    constructor () {
        this.URL = 'https://www.flashscore.ru/'
        this.driver = null
        this.leagues = null
    }

    async init() {
        this.driver = await new Builder()
            .withCapabilities(
                new Capabilities().setPageLoadStrategy('normal')
            )
            .forBrowser('chrome')
            .setChromeService(new chrome.ServiceBuilder(process.env.CHROMEDRIVER_PATH))
            .setChromeOptions(
                (new chrome.Options())
                    .addArguments(
                        '--disable-gpu',
                        '--headless',
                        '--log-level=3',
                        )
                    .setChromeBinaryPath(process.env.CHROME_BIN)
            )
            // .setFirefoxOptions(
            //     new firefox.Options()
            //         // .headless()
            //     )
            .build()

    }

    async run() {
        await this.init()
        await this.driver.get(this.URL)
    }

    async getLeagues(className = '.event__titleBox', ch = ': ') {
        this.leagues = await Promise.all((await this.driver.findElements(By.css(className))).map(async x => {
            try {
                return (await x.getText()).split('\n').slice(0, 2).join('\n').replace('\n', ch)
            } catch {
                return ''
            }
        }))

        return this.leagues
    }

    async getMatchesOfLeague(index, options, sendStatistics) {
        const defaultOptions = {
            needToExpand: false,
            allMatches: false,
            onlyMatches: false,
            sliceFrom: 0,
            sliceTo: undefined
        }
        const { needToExpand, allMatches, onlyMatches, sliceFrom, sliceTo } = Object.assign({}, defaultOptions, options)

        // need to expand
        if (needToExpand) {
            if (!allMatches) {
                const eventHeader = (await this.driver.findElements(By.css('div.event__header')))[index - 1]
                if (eventHeader && (await eventHeader.getAttribute('class')).includes('event__header--no-my-games')) {
                    const showMoreButton = (await eventHeader.findElements(By.css('.event__info')))[0]
                    await this.driver.executeScript('arguments[0].click()', showMoreButton)
                }
            } else {
                for (const eventHeader of await this.driver.findElements(By.css('div.event__header'))) {
                    if (eventHeader && (await eventHeader.getAttribute('class')).includes('event__header--no-my-games')) {
                        const showMoreButton = (await eventHeader.findElements(By.css('.event__info')))[0]
                        await this.driver.executeScript('arguments[0].click()', showMoreButton)
                    }
                }

            }
        }

        const xpath = !allMatches ? `
            //div[contains(@class, 'event__header')][${index}]/
                following-sibling::div[contains(@class, 'event__header')][1]/
                    preceding-sibling::div[
                        preceding-sibling::div[contains(@class, 'event__header')][${index}]
                    ]
        ` : `//div[contains(@class, 'event__match')]`

        const xpathLastLeague = `//div[contains(@class, 'event__header')][${index}]/following-sibling::div[contains(@class, 'event__match')]`

        let matches = (await this.driver.findElements(By.xpath(xpath))).slice(sliceFrom, sliceTo)

        if (!allMatches && matches.length === 0) {
            matches = (await this.driver.findElements(By.xpath(xpathLastLeague))).slice(sliceFrom, sliceTo)
        }
                
        const matchesInfo = []
        const strings = []
        
        if (!onlyMatches) {
            for (const x of matches) {
                try {
                    const teams = (await Promise.all((await x.findElements(By.css('.event__participant'))).map(async y => await y.getText())))
    
                    let timeOrStatus = ''
                    try {
                        timeOrStatus = (await (await x.findElements(By.css('.event__time')))[0].getText()) || ''
                    } catch {
                        try {
                            timeOrStatus = (await (await x.findElements(By.css('.event__stage')))[0].getText()).trim() || ''
                        } catch {}
                    }
    
                    timeOrStatus = timeOrStatus.replace('\n', ' ').split(' ')[0]
                    if (timeOrStatus.slice(-1)[0] === '.') timeOrStatus += new Date().getFullYear()
    
                    const goals = (await (await x.findElements(By.css('.event__scores')))[0].getText()).replace(/\s/g, '').match(/(\d+)/g)

                    const goalsFirstTimeElement = (await x.findElements(By.css('.event__part'))).slice(-1)
                    let goalsFirstTime
                    if (goalsFirstTimeElement.length >= 1) {
                        goalsFirstTime = (await goalsFirstTimeElement[0].getText()).replace(/\s/g, '').match(/(\d+)/g)
                    }
                    // win lose draw
                    const wld = await (await x.findElements(By.css('.wld')))[0].getText()
    
                    const infoDict = {
                        first: {
                            name: teams[0],
                            goals: +goals[0],
                            goalsFirstTime: goalsFirstTime ? +goalsFirstTime[0] : 0,
                            goalsSecondTime: goalsFirstTime ? ((goals[2] || goals[0]) - goalsFirstTime[0]) : 0,
                        },
                        second: {
                            name: teams[1],
                            goals: +goals[1],
                            goalsFirstTime: goalsFirstTime ? +goalsFirstTime[1] : 0,
                            goalsSecondTime: goalsFirstTime ? ((goals[3] || goals[1]) - goalsFirstTime[1]) : 0,
                        },
                        result: wld,
                        timeOrStatus,
                    }
    
                    matchesInfo.push(infoDict)
    
                    if (sendStatistics) sendStatistics('series', 1, 1, matches.length)
                    strings.push(`${teams.join(' - ')} (${timeOrStatus})`)
                } catch {
                    if (sendStatistics) sendStatistics('series', 1, 1, matches.length)
                    strings.push('')
                }
            }
        }

        const returnDict = {
            matches, strings, matchesInfo
        }

        return returnDict
    }

    async getMatch(leagueIndex, matchIndex, idArray) {
        if (idArray) {
            await this.driver.get(`${this.URL}match/${idArray[matchIndex - 1]}/#h2h`)
            return
        }

        const match = (await this.getMatchesOfLeague(leagueIndex, { onlyMatches: true })).matches[matchIndex]

        const id = (await match.getAttribute('id')).split('_').pop()

        await this.driver.get(`${this.URL}match/${id}/#h2h`)
    }

    async checkTimeGoals(league, sliceFrom = 0, seekSeriesInFirstMatches = 10, filterOptions, sendStatistics) {
        // expand all matches
        let maxedOut = false
        try {
            await this.driver.wait(async () => {
                await this.driver.executeScript(`glib_show_hidden('tab-h2h-overall', 'h2h_home', 200); glib_show_hidden('tab-h2h-overall', 'h2h_away', 200)`)
                return (await this.driver.findElements(By.css('table.h2h_home tbody > tr.highlight:not(.hidden)'))).length > Math.max(seekSeriesInFirstMatches + 10, 16)
            }, 5000)
        } catch {
            maxedOut = true
        }
        // await this.driver.executeScript(`glib_show_hidden('tab-h2h-overall', 'h2h_home', 200)`)
        // await this.driver.executeScript(`glib_show_hidden('tab-h2h-overall', 'h2h_away', 200)`)
        // await this.driver.executeScript(`glib_show_hidden('tab-h2h-overall', 'h2h_mutual', 200)`)

        const teamsElement = await this.driver.findElements(By.css('.tname .participant-imglink'))
        await this.driver.wait(until.elementIsVisible(teamsElement[0]))

        const teamNames = await Promise.all(teamsElement.map(async x => (await x.getText()).split('(')[0].trim()))

        console.log('teamNames', teamNames)

        // don't need third table because we can calculate mutual by filter ('table.h2h_mutual tbody > tr.highlight')
        const returnDicts = []
        for (const matchesSelector of ['table.h2h_home tbody > tr.highlight', 'table.h2h_away tbody > tr.highlight']) {
            let matches = await this.driver.findElements(By.css(matchesSelector))

            if (league && league.length > 0) {
                const leaguesArray = league.map(x => x.split(':')[1].trim().split('-')[0].trim().toLowerCase())
                let leaguesOnSite = await this.driver.findElements(By.css(matchesSelector + ' .flag_td'))
                leaguesOnSite = await Promise.all(leaguesOnSite.map(async x => (await x.getAttribute('title')).split('(')[0].trim().toLowerCase()))

                console.log('before', league, matches.length, leaguesArray)

                matches = matches
                    .filter((x, i) => {
                        console.log(i, leaguesOnSite[i], leaguesArray.includes(leaguesOnSite[i]))
                        return leaguesArray.includes(leaguesOnSite[i])
                    })

                console.log('after', league, matches.length)
            }
            
            matches = matches.slice(sliceFrom, seekSeriesInFirstMatches)
            console.log(matches.length)

            const matchesInfo = []
            const strings = []

            for (const x of matches) {
                try {
                    const teams = (await Promise.all((await x.findElements(By.css('td.name'))).map(async y => await y.getText())))
                    
                    const timeOrStatus = (await (await x.findElements(By.css('span.date')))[0].getText()) || ''
                    const spanScore = await x.findElements(By.css('span.score'))
                    const goals = (await spanScore[0].getText()).replace(/\s/g, '').match(/(\d+)/g)
                    // win lose draw
                    const wld = await (await x.findElements(By.css('.wld')))[0].getText()
                    
                    const matchId = (await x.getAttribute('onclick')).split('\'').slice(-2, -1)[0].split('_').pop()
                    
                    sendStatistics('series', 0, 1, matches.length * 2) // 2 selectors - 2 teams

                    const infoDict = {
                        first: {
                            name: teams[0],
                            goals: goals[0],
                        },
                        second: {
                            name: teams[1],
                            goals: goals[1],
                        },
                        result: wld,
                        timeOrStatus,
                        matchId,
                        matchUrl: `${this.URL}match/${matchId}`
                    }

                    matchesInfo.push(infoDict)
                    strings.push(`${teams.join(' - ')} (${timeOrStatus})`)

                } catch (e) {
                    console.log(e)
                    strings.push('')
                }
            }

            const seriesMatchUrl = await this.driver.getCurrentUrl()
            const returnDict = {
                matches, strings, matchesInfo, teamNames, seriesMatchUrl, maxedOut
            }

            returnDicts.push(returnDict)
        }

        if (filterOptions.time !== 0) {
            for (const returnDict of returnDicts) {
                for (let matchElement of returnDict.matchesInfo) {
                    await this.driver.get(`${this.URL}match/${matchElement.matchId}`)
                    await this.driver.wait(until.elementsLocated(By.css('.detailMS__headerScore')))

                    const scoresElement = await this.driver.findElements(By.css('.detailMS__headerScore'))
                    await this.driver.wait(until.elementTextMatches(scoresElement[0], /(\d+)/g))

                    const goalsTimed = await Promise.all(scoresElement.map(async y => (await y.getText()).replace(/\s/g, '').match(/(\d+)/g)))
    
                    sendStatistics('series', 1, 1, returnDict.matchesInfo.length * returnDicts.length)
        
                    let first = {}, second = {}
        
                    if (goalsTimed.length == 3 || goalsTimed.length == 2) {
                        first = { goalsFirstTime: goalsTimed[0][0], goalsSecondTime: +goalsTimed[0][0] + +goalsTimed[1][0] }
                        second = { goalsFirstTime: goalsTimed[0][1], goalsSecondTime: +goalsTimed[0][1] + +goalsTimed[1][1] }
                        console.log('goalsTime', goalsTimed, first, second)
                    } else if (goalsTimed.length == 1) {
                        first = { filteredGoals: goalsTimed[0][0] }
                        second = { filteredGoals: goalsTimed[0][1] }
                        console.log('filteredGoals', goalsTimed)
                    }
        
                    matchElement.first = {
                            ...matchElement.first,
                            ...first
                        }
                    matchElement.second = {
                            ...matchElement.second,
                            ...second
                        }    
                }
            }

        } else {
            sendStatistics('series', 1, 1, 1)
        }

        return returnDicts
    }
    
    // historical data
    async goToTeamPages(matchUrl, filterOptions, analizeOptions, newElementFoundCallback, sendStatistics) {
        if (matchUrl) await this.driver.get(matchUrl)

        const teams = await this.driver.findElements(By.css('.tname .participant-imglink'))
        const teamUrls = await Promise.all(teams.map(async x => (await x.getAttribute('onclick')).split('\'')[1].slice(1)))
        const teamNames = await Promise.all(teams.map(async x => (await x.getText()).split('(')[0].trim()))
        
        console.log(teamNames)

        const results = []

        for (const [ind, x] of teamUrls.entries()) {
            sendStatistics('matches', 0, 1, teamUrls.length)

            let historicalSeriesMatch = { gamesAfterLimit: [] }

            if (filterOptions.needToParse[ind]) {
                historicalSeriesMatch = await this.getAllMatchesOfTeam(`${this.URL}${x}/results`, ind, teamNames, filterOptions, analizeOptions, sendStatistics)
                historicalSeriesMatch.matchUrl = `${this.URL}${x}/results`
    
                // TODO: do we need to remove element in case of one league search (&& !(filterOptions.league && filterOptions.league.length > 0))
                if (filterOptions.removeUnsafeMatch) {
                    console.log(`Deleted ${historicalSeriesMatch.reps[0]} first elements.`)
                    
                    if (historicalSeriesMatch.reps[0] === historicalSeriesMatch.series[0]) {
                        Object.keys(historicalSeriesMatch).forEach(key => {
                            if (typeof historicalSeriesMatch[key] == 'object') // array
                                historicalSeriesMatch[key] = historicalSeriesMatch[key].slice(1)
                        })
                    }
    
                }
            }

            newElementFoundCallback(historicalSeriesMatch)
            results.push(historicalSeriesMatch)
        }

        return { results, teamNames, teamUrls }
    }

    // historical data
    async getAllMatchesOfTeam(teamUrl, ind, teamNames, filterOptions, analizeOptions, sendStatistics) {
        await this.driver.get(teamUrl)

        const time = performance.now()
        
        // expand till the end OR till set year
        await this.driver.wait(async () => {
            const loadingOverlay = (await this.driver.findElements(By.css('.loadingOverlay')))[0]
            await this.driver.wait(until.elementIsNotVisible(loadingOverlay), 5000)

            let showMore = (await this.driver.findElements(By.css('.event__more')))[0]
            if (!showMore) return true
            if (await showMore.isEnabled()) {
                await this.driver.executeScript('arguments[0].click()', showMore)
            }

            const lastMatchDate = (await (await this.driver.findElements(By.css('.event__time'))).pop().getText())

            sendStatistics('series', 0, Math.min((new Date()).getFullYear() - +lastMatchDate.split('\n')[0].split('.').pop(), analizeOptions.yearFrom), analizeOptions.yearFrom, true)
            
            console.log((new Date()).getFullYear(), +lastMatchDate.split('\n')[0].split('.').pop(), lastMatchDate)
            if ((new Date()).getFullYear() - +lastMatchDate.split('\n')[0].split('.').pop() > analizeOptions.yearFrom)
                return true

            return !showMore || !(until.stalenessOf(showMore))
        })

        let matches = { matches: [], matchesInfo: [], strings: [] }
        if (filterOptions.withLeague) {
            let leagues = await this.getLeagues('.event__header')
            // leagues = leagues.map(x => x.split('-')[0].trim().toLowerCase())
    
            for (let [i, league] of leagues.entries()) {
                const newMatches = await this.getMatchesOfLeague(i + 1, { sliceTo: filterOptions.sliceNMatches }, sendStatistics)
                newMatches.matchesInfo = newMatches.matchesInfo.map(x => ({ ...x, league }))
                matches = {
                    matches: [ ...matches.matches, ...newMatches.matches ],
                    matchesInfo: [ ...matches.matchesInfo, ...newMatches.matchesInfo ],
                    strings: [ ...matches.strings, ...newMatches.strings ],
                }
                sendStatistics('series', 0, 1, 1)
            }
        } else
        if (filterOptions.leagues && filterOptions.leagues.length > 0) {
            let leagues = await this.getLeagues('.event__header')
            leagues = leagues.map(x => x.split('-')[0].trim().toLowerCase())

            const processedLeagues = filterOptions.leagues.map(x => x.split('-')[0].trim().toLowerCase())

            const leagueIndexes = leagues.map((x, i) => processedLeagues.some(y => x.startsWith(y)) ? i : -1).filter(x => x >= 0)

            console.log('check leagues', leagueIndexes.map(x => leagues[x]))

            for (let [i, league] of leagueIndexes.entries()) {
                // const newMatches = await this.getMatchesOfLeague(i + 1, false, false, 0, filterOptions.sliceNMatches, sendStatistics)
                const newMatches = await this.getMatchesOfLeague(i + 1, { sliceTo: filterOptions.sliceNMatches }, sendStatistics)
                newMatches.matchesInfo = newMatches.matchesInfo.map(x => ({ ...x, league }))
                matches = {
                    matches: [ ...matches.matches, ...newMatches.matches ],
                    matchesInfo: [ ...matches.matchesInfo, ...newMatches.matchesInfo ],
                    strings: [ ...matches.strings, ...newMatches.strings ],
                }
                sendStatistics('series', 0, 1, 1)
            }
        } else {
            // matches = await this.getMatchesOfLeague(0, false, true, 0, filterOptions.sliceNMatches, sendStatistics)
            matches = await this.getMatchesOfLeague(0, { allMatches: true, sliceTo: filterOptions.sliceNMatches }, sendStatistics)
            sendStatistics('series', 0, 1, 1)
        }
        // TODO:

        console.log('Matches length =', matches.matches.length)
        console.log('Elapsed time', performance.now() - time)

        console.log(teamNames)
        
        // console.log(JSON.stringify(matches.matchesInfo, null, 4))
        console.log('analizy options', analizeOptions, ind)
        
        if (filterOptions.pureMatches) return matches.matchesInfo

        const teamName = (await (await this.driver.findElements(By.css('.teamHeader__name')))[0].getText()).trim()

        const filtered = this.filterGames(teamNames[0], matches, teamNames[1], filterOptions)
        return { ...this.analizeTeam(filtered, teamName, { ...analizeOptions, limit: analizeOptions.limit[ind] }), totalMatches: matches.matches.length }
    }

    // mode: ['winlose' (o[wld], wl, wd, ld), 'goals' (sumtotal, total, legup), 'hitgate' (both, onenot, onezero)]
    // arg - value for goals mode
    analizeTeam(filtered, teamName, options = { mode: 'winlose', sub: 'ow', limit: 0, arg: 0 }) {
        console.log('analizeOptions', options)
        const games = [...filtered.matchesInfo].reverse()

        const wlHelpDict = { 'w': 'НП', 'l': 'НВ', 'd': 'ВП', 'wl': 'Н', 'wd': 'П', 'ld': 'В' }

        let wlSeq, goalsReps, hitgateReps

        if (options.mode == 'winlose') {
            wlSeq = games.map(x => x.result).join('')

            if (options.sub[0] == 'o') {
                const removeChars = wlHelpDict[options.sub[1]]
                wlSeq = wlSeq.replace(new RegExp(removeChars.split('').join('|'), 'g'), '.').split('.').map(x => x.length)

            } else {
                wlSeq = wlSeq.split(wlHelpDict[options.sub]).map(x => x.length)
            }
        } else if (options.mode == 'goals') {
            const nameCompare = (matchObj) => matchObj.name.split('(')[0].trim().toLowerCase() === teamName.toLowerCase()
            const operationCompare = (a, b, op = '=') => ({ '=': a === b, '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b }[op])

            if (options.sub == 'sumtotal') {
                goalsReps = games.map(x => +x.first.filteredGoals + +x.second.filteredGoals).map(x => operationCompare(x, options.arg, options.operation) ? 1 : '-').join('').split('-').map(x => x.length)
            } else if (options.sub == 'total') {
                goalsReps = games.map(x => nameCompare(x.first) ? x.first.filteredGoals : x.second.filteredGoals).map(x => operationCompare(+x, options.arg, options.operation) ? 1 : '-').join('').split('-').map(x => x.length)
            } else if (options.sub == 'missed') {
                goalsReps = games.map(x => nameCompare(x.first) ? x.second.filteredGoals : x.first.filteredGoals).map(x => operationCompare(+x, options.arg, options.operation) ? 1 : '-').join('').split('-').map(x => x.length)
            } else {
                goalsReps = games.map(x => nameCompare(x.first) ? x.first.filteredGoals - x.second.filteredGoals : x.second.filteredGoals - x.first.filteredGoals).map(x => +x > -options.arg ? 1 : '-').join('').split('-').map(x => x.length)
            }
        } else if (options.mode == 'hitgate') {
            if (options.sub == 'both') {
                hitgateReps = games.map(x => +(x.first.goals > 0 && x.second.goals > 0)).join('').replace(/0/g, '.').split('.').map(x => x.length)
            } else if (options.sub == 'onenot') {
                hitgateReps = games.map(x => +(x.first.goals == 0 || x.second.goals == 0)).join('').replace(/0/g, '.').split('.').map(x => x.length)
            } else { // onezero
                hitgateReps = games.map(x => +!!(x.first.goals > 0 ^ x.second.goals > 0)).join('').replace(/0/g, '.').split('.').map(x => x.length)
            }
        }

        const reps = wlSeq || goalsReps || hitgateReps
        const saveIndexes = []
        const fullIndexes = []
        const series = []

        const red = reps.reduce((a, b) => {
            if (b >= options.limit) {
                saveIndexes.push(a + Math.min(b, options.limit))
                fullIndexes.push(a + b)
                series.push(b)
            }
            return a + b + 1
        }, 0)

        return { saveIndexes, fullIndexes, gamesAfterLimit: saveIndexes.map(x => games[x]), reps, series }
    }

    filterGames(teamName, matches, opponentTeamName, options = { time: 0, host: 'all', mutual: false }) {
        const nameCompare = (matchObj, opName) => matchObj.name.split('(')[0].trim().toLowerCase() === (opName || teamName).toLowerCase()
        console.log('filter', teamName, opponentTeamName, matches.matchesInfo.length)

        if (options.host == 'home')
            matches.matchesInfo = matches.matchesInfo.filter(x => nameCompare(x.first))
        else if (options.host == 'away')
            matches.matchesInfo = matches.matchesInfo.filter(x => nameCompare(x.second, opponentTeamName))

        if (options.mutual) {
            matches.matchesInfo = matches.matchesInfo.filter(x => nameCompare(x.first) && nameCompare(x.second, opponentTeamName))
        }
        console.log('filter after', teamName, opponentTeamName, matches.matchesInfo.length)

        matches.matchesInfo = matches.matchesInfo.map(x => {
            const chooseGoals = (t) => options.time == 2 ? (t.goalsSecondTime || t.goals) - t.goalsFirstTime : options.time == 1 ? t.goalsFirstTime : t.goals
            if (x.first.filteredGoals === undefined && x.second.filteredGoals === undefined) {
                x.first.filteredGoals = chooseGoals(x.first)
                x.second.filteredGoals = chooseGoals(x.second)
            }
            return x
        })
        
        return matches
    }

    async getMatchIdArray(...args) {
        const matchesId = await Promise.all((await this.getMatchesOfLeague(...args)).matches.map(async match => (await match.getAttribute('id')).split('_').pop()))
        
        return matchesId
    }
    
    async getMatchIdArraySequentally(...args) {
        let leagues = [], matches = []
        for (const [index, league] of this.leagues.entries()) {
            const partialMatches = await Promise.all((await this.getMatchesOfLeague(index + 1, ...args)).matches.map(async match => (await match.getAttribute('id')).split('_').pop()))
            leagues = [ ...leagues, ...[...Array(partialMatches.length)].map(_ => league) ]
            matches.push(...partialMatches)
        }
        return { leagues, matches }
    }

    // find teams firing a series streak NOW
    async findSeriesForLeague(leagueIndex, filterOptions, analizeOptions, newElementFoundCallback, sendStatistics) {
        if (await this.driver.getCurrentUrl() !== this.URL) await this.driver.get(this.URL)

        const fitTeams = []
        let matchesId, leaguesAndMatches = { leagues: [] }
        console.log('allMatches', filterOptions.allMatchesSearch)

        if (filterOptions.allMatchesSearch && filterOptions.searchOneLeague) {
            leaguesAndMatches = await this.getMatchIdArraySequentally({ needToExpand: true, onlyMatches: true })
            matchesId = leaguesAndMatches.matches
        } else
            matchesId = await this.getMatchIdArray(leagueIndex, filterOptions.allMatchesSearch ? { needToExpand: true, allMatches: true, onlyMatches: true } : { onlyMatches: true })
            
        console.log('matchesId', matchesId)
        console.log(matchesId.length)

        for (let i = 1; i < matchesId.length + 1; i++) {
            await this.getMatch(0, i, matchesId)

            sendStatistics('matches', 0, 1, matchesId.length)

            let numberOfSeries = 0, limitFrom = 0, seriesMaxedOut = false, seriesAccumulator = [{ matchesInfo: [] }, { matchesInfo: [] }]

            const leagueForMatch = leaguesAndMatches.leagues.length > 0 ? [ leaguesAndMatches.leagues[i - 1] ] : filterOptions.leagues

            while (numberOfSeries < 2 && !seriesMaxedOut) {
                var checkingForSeriesStartMatches = await this.checkTimeGoals(leagueForMatch, limitFrom, analizeOptions.limitTo + limitFrom, filterOptions, sendStatistics)
                console.log('options', filterOptions, analizeOptions)

                var filtered = [], analizedGames = []

                for (const [index, match] of checkingForSeriesStartMatches.entries()) {
                    seriesAccumulator[index].matchesInfo = [ ...seriesAccumulator[index].matchesInfo, ...match.matchesInfo ]

                    filtered.push(this.filterGames(match.teamNames[0], seriesAccumulator[index], match.teamNames[1], filterOptions))
                    analizedGames.push(this.analizeTeam(filtered[index], match.teamNames[index], analizeOptions)) // { mode: 'winlose', sub: 'wl', limit: 1}
                }

                console.log('consecutive', analizedGames[0].saveIndexes, analizedGames[0].reps, analizedGames[1].saveIndexes, analizedGames[1].reps)
                console.log('IMPORTANT', analizedGames.map(x => x.reps.length), Math.min(...analizedGames.map(x => x.reps.length)), limitFrom, analizeOptions.limitTo + limitFrom)
                numberOfSeries = Math.min(...analizedGames.map(x => x.reps.length))
                seriesMaxedOut = !!Math.max(...checkingForSeriesStartMatches.map(x => x.maxedOut))
                console.log('seriesMaxedOut', seriesMaxedOut, checkingForSeriesStartMatches.map(x => x.maxedOut))

                limitFrom = analizeOptions.limitTo + limitFrom
            }

            if (analizedGames.some(x => x.reps.slice(-1)[0] >= analizeOptions.limit && x.reps.slice(-1)[0] <= analizeOptions.limitTo)) {
                console.log('Found a match with series')

                const lastSeriesGame = {
                    first: { name: checkingForSeriesStartMatches[0].teamNames[0] },
                    second: { name: checkingForSeriesStartMatches[0].teamNames[1] },
                    series: analizedGames.map(x => x.reps.slice(-1)[0]),
                    matchUrl: checkingForSeriesStartMatches[0].seriesMatchUrl,
                    league: leagueForMatch[0]
                }
                
                fitTeams.push(lastSeriesGame)
                
                newElementFoundCallback(lastSeriesGame)
            }
        }

        return fitTeams
    }

    async fillingDatabase(sendStatistics, callbacks, daysAhead = 2) {
        // try {
        //     (await this.driver.switchTo().alert()).accept()
        // } catch {}

        const deleteOutdatedDocs = async previousDate => {
            await Promise.all((await db.collection('matchesToParse').where('forDate', '<=', previousDate).get())
                .docs.map(async doc => await doc.ref.delete()))

            await Promise.all((await db.collection('current').where('date', '<=', previousDate).get())
                .docs.map(async doc => await doc.ref.delete()))
        }

        for (let idate = 0; idate < daysAhead; idate++) {
            if (await this.driver.getCurrentUrl() !== this.URL) await this.driver.get(this.URL)
            
            const datapickerElement = (await this.driver.findElements(By.css('.calendar__datepicker')))[0]

            if (idate !== 0) {
                await datapickerElement.click()

                const datesElement = (await this.driver.findElements(By.css('.calendar__datepicker--dates')))[0]
                // await (await datesElement.findElements(By.css('.day')))[7 + i].click()
                await this.driver.executeScript('arguments[0].click()', (await datesElement.findElements(By.css('.day')))[7 + i])
                // await this.driver.findElements(By.xpath('//div[@class="calendar__datepicker--dates"]/'))
                // const nextDayElement = await this.driver.findElements(By.css('.calendar__direction--tomorrow'))[0]
            }

            const datapickerText = await datapickerElement.getText()
            const dateOfMatch = new Date([...[...datapickerText.split('/').map(x => parseInt(x))].reverse(), new Date().getFullYear()].join('/'))
            const previousDay = new Date(dateOfMatch.getTime())
            previousDay.setDate(dateOfMatch.getDate() - 1)

            console.log('Parsing matches for', dateOfMatch)

            // console.log(await this.getAllMatchesOfTeam('https://www.flashscore.ru/team/pumas-tabasco/fsxIAE02/results/', 0, ['', ''], { withLeague: true, pureMatches: true }, {}, () => {}))

            // return

            // const fitTeams = []
            let matchesId, leaguesAndMatches = { leagues: [] }
    
            const progressDoc = await db.collection('progress').where('date', '==', dateOfMatch).get()
            if (!progressDoc.empty) {
                const docData = progressDoc.docs[0].data()
                const everythingParsed = docData.date.toDate().getTime() === dateOfMatch.getTime() && docData.finished
                console.log('Everything is already parsed:', everythingParsed)
                if (everythingParsed) return
            }
    
            const matchesToParseSnap = await db.collection('matchesToParse').where('forDate', '==', dateOfMatch).get()
    
            if (matchesToParseSnap.empty) {
                leaguesAndMatches = await this.getMatchIdArraySequentally({ needToExpand: true, onlyMatches: true })
                await db.collection('matchesToParse').add({
                    forDate: dateOfMatch,
                    ...leaguesAndMatches
                })
            } else {
                const matchesToParse = matchesToParseSnap.docs[0].data()
                leaguesAndMatches = matchesToParse
            }
            matchesId = leaguesAndMatches.matches
    
            console.log('matchesId', matchesId)
            console.log(matchesId.length)
    
            let matchesInDb = await db.collection('current').where('date', '==', dateOfMatch).get()
            let matchesIdsInDb
    
            if (!matchesInDb.empty) {
                matchesInDb = matchesInDb.docs.map(x => x.data())
                callbacks.assign(matchesInDb)
                matchesIdsInDb = matchesInDb.reduce((a, b) => [ ...a, b.matchId ], [])
            }
    
            for (let i = 1; i < matchesId.length + 1; i++) {
                if (matchesIdsInDb && matchesIdsInDb.includes(matchesId[i - 1])) {
                    console.log(`We have a match with id: ${matchesId[i - 1]} in the db (skipping).`)
                    continue
                }
                if (i % 10 === 0) {
                    await (await db.collection('progress').where('date', '==', dateOfMatch).get()).docs[0].ref.update({
                        current: i,
                        total: matchesId.length,
                        finished: false,
                        date: dateOfMatch
                    })
                }
    
                const matchesInfoArray = await this.goToTeamPages(`${this.URL}match/${matchesId[i - 1]}`,
                {
                    time: 0,
                    host: 'all',
                    mutual: false,
                    leagues: [],
                    searchOneLeague: false,
                    allMatchesSearch: true,
                    pureMatches: true,
                    withLeague: true,
                    sliceNMatches: undefined,
                    removeUnsafeMatch: false,
                    needToParse: [true, true]
                },
                {
                    mode: '',
                    sub: '',
                    limit: '',
                    arg: '',
                    limitTo: '',
                    yearFrom: 1,
                    operation: ''
                }, () => {}, sendStatistics)
    
                sendStatistics('matches', 0, 1, matchesId.length)
    
                const currentMatch = {
                    link: `${this.URL}match/${matchesId[i - 1]}/#h2h`,
                    matchId: matchesId[i - 1],
                    league: leaguesAndMatches.leagues[i - 1],
                    date: dateOfMatch,
                    parsing_ended: new Date(),
                    first: {
                        name: matchesInfoArray.teamNames[0],
                        url: `${this.URL}${matchesInfoArray.teamUrls[0]}`,
                        matches: matchesInfoArray.results[0]
                    },
                    second: {
                        name: matchesInfoArray.teamNames[1],
                        url: `${this.URL}${matchesInfoArray.teamUrls[1]}`,
                        matches: matchesInfoArray.results[1]
                    }
                }
    
                callbacks.push(currentMatch)
    
                const id = (await db.collection('current').add(currentMatch)).id
            }
    
            await (await db.collection('progress').where('date', '==', dateOfMatch).get()).docs[0].ref.update({
                current: matchesId.length,
                total: matchesId.length,
                finished: true,
                date: dateOfMatch
            })
            
            if (idate === 0) {
                await deleteOutdatedDocs(previousDay)
            }
        }

    }
}

module.exports = FlashScore

// ;(async () => {
//     let flash = null;
//     try {
//         flash = new FlashScore()
//         await flash.run()
        
        
//         await flash.getMatch(1, 1)
//         await flash.goToTeamPages('https://www.flashscore.ru/match/IFkPs7dj/#h2h;overall', undefined, {mode: 'winlose', sub:'wl', limit:2}, ()=>{}, ()=>{})

//         // await flash.getAllMatchesOfTeam('https://www.flashscore.ru/team/zenit-st-petersburg/vsXou9m7/results/')
//         // await flash.findSeriesForLeague()

//         // const leagues = await flash.getLeagues()

//         // let matches = await flash.getMatchesOfLeague(13)
//         // console.log(matches)
//         // matches = await flash.getMatchesOfLeague(12)
//         // console.log(matches)


//         // console.log(leagues.length)
//         // await flash.driver.quit()
//     } catch (e) {
//         console.error(e)
//         if (flash)
//             await flash.driver.quit()
//     }
// })()