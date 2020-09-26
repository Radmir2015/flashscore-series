const { Builder, By, Key, until, Capabilities } = require('selenium-webdriver')
const firefox = require('selenium-webdriver/firefox')
const chrome = require('selenium-webdriver/chrome')

class FlashScore {
    constructor () {
        this.URL = 'https://www.flashscore.ru/'
        this.driver = null
    }

    async init() {
        this.driver = await new Builder()
            .withCapabilities(
                new Capabilities().setPageLoadStrategy('normal')
            )
            .forBrowser('chrome')
            .setChromeOptions(
                (new chrome.Options()).addArguments(
                    '--disable-gpu',
                    '--headless',
                    '--log-level=3',
                    )
                    
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
        return await Promise.all((await this.driver.findElements(By.css(className))).map(async x => {
            try {
                return (await x.getText()).split('\n').slice(0, 2).join('\n').replace('\n', ch)
            } catch {
                return ''
            }
        }))
    }

    async getMatchesOfLeague(index, needToExpand = true, allMatches = false, sliceFrom = 0, sliceTo, sendStatistics) {
        // const xpath = `//*[preceding-sibling::div[contains(@class, 'event__header')][${index}] and following-sibling::div[contains(@class, 'event__header')][${index + 1}]]`
        
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

        const matches = (await this.driver.findElements(By.xpath(xpath))).slice(sliceFrom, sliceTo)
                
        const matchesInfo = []
        const strings = []
        // console.log(matches)
        // const strings = await Promise.all(matches.map(async x => {
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
                const goalsFirstTime = (await (await x.findElements(By.css('.event__part'))).slice(-1)[0].getText()).replace(/\s/g, '').match(/(\d+)/g)
                // win lose draw
                const wld = await (await x.findElements(By.css('.wld')))[0].getText()

                const infoDict = {
                    first: {
                        name: teams[0],
                        goals: goals[0],
                        goalsFirstTime: goalsFirstTime[0],
                        goalsSecondTime: (goals[2] || goals[0]) - goalsFirstTime[0],
                    },
                    second: {
                        name: teams[1],
                        goals: goals[1],
                        goalsFirstTime: goalsFirstTime[1],
                        goalsSecondTime: (goals[3] || goals[1]) - goalsFirstTime[1],
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

        const returnDict = {
            matches, strings, matchesInfo
        }

        return returnDict
    }

    async getMatch(leagueIndex, matchIndex, idArray) {
        // await this.driver.get(this.URL)

        // await this.driver.sleep(5000)

        if (idArray) {
            await this.driver.get(`${this.URL}match/${idArray[matchIndex - 1]}/#h2h`)
            return
        }

        const match = (await this.getMatchesOfLeague(leagueIndex)).matches[matchIndex]

        const id = (await match.getAttribute('id')).split('_').pop()

        await this.driver.get(`${this.URL}match/${id}/#h2h`)

        // await this.driver.executeScript('arguments[0].click()', match)
        // await this.driver.sleep(2000)
        
        // await this.driver.switchTo().window((await this.driver.getAllWindowHandles())[1])
        // await this.driver.sleep(2000)
        // await this.driver.executeScript(`detail_tab('head-2-head')`)
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

        // await this.driver.sleep(10000)
        // const h2hHome = (await this.driver.findElements(By.css('table.h2h_home')))[0]
        // const results = await Promise.all((await h2hHome.findElements(By.css('.wld'))).map(async x => await x.getText()))

        // don't need third table because we can calculate mutual by filter ('table.h2h_mutual tbody > tr.highlight')
        const returnDicts = []
        for (const matchesSelector of ['table.h2h_home tbody > tr.highlight', 'table.h2h_away tbody > tr.highlight']) {
        // return await Promise.all(['table.h2h_home tbody > tr.highlight', 'table.h2h_away tbody > tr.highlight'].map(async matchesSelector => {
            // console.log('matches', matchesSelector)
            let matches = await this.driver.findElements(By.css(matchesSelector))

            // console.log(matches.length)
            
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
            
            // if (matches.length > seekSeriesInFirstMatches)
            matches = matches.slice(sliceFrom, seekSeriesInFirstMatches)
            console.log(matches.length)

            
            const matchesInfo = []
            const strings = []
            // console.log(matches)
            for (const x of matches) {
                try {
                    const teams = (await Promise.all((await x.findElements(By.css('td.name'))).map(async y => await y.getText())))
                    
                    const timeOrStatus = (await (await x.findElements(By.css('span.date')))[0].getText()) || ''
                    
                    const spanScore = await x.findElements(By.css('span.score'))

                    // await this.driver.wait(until.elementTextMatches(spanScore[0], /(\d+)/g))
                    const goals = (await spanScore[0].getText()).replace(/\s/g, '').match(/(\d+)/g)

                    const wld = await (await x.findElements(By.css('.wld')))[0].getText()
                    
                    // await this.driver.sleep(3000)
                    
                    const matchId = (await x.getAttribute('onclick')).split('\'').slice(-2, -1)[0].split('_').pop()
                    
                    sendStatistics('series', 0, 1, matches.length * 2) // 2 selectors - 2 teams

                    // win lose draw

                    const infoDict = {
                        first: {
                            name: teams[0],
                            goals: goals[0],
                            // ...first
                        },
                        second: {
                            name: teams[1],
                            goals: goals[1],
                            // ...second
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
            // const strings = await Promise.all(matches.map(async x => {
            //     try {
            //         const teams = (await Promise.all((await x.findElements(By.css('td.name'))).map(async y => await y.getText())))
    
            //         let timeOrStatus = ''
            //         // try {
            //             timeOrStatus = (await (await x.findElements(By.css('span.date')))[0].getText()) || ''
            //         // } catch {
            //         //     try {
            //         //         timeOrStatus = (await (await x.findElements(By.css('.event__stage')))[0].getText()).trim() || ''
            //         //     } catch {}
            //         // }
    
            //         const goals = (await (await x.findElements(By.css('span.score')))[0].getText()).replace(/\s/g, '').match(/(\d+)/g)
            //         const wld = await (await x.findElements(By.css('.wld')))[0].getText()

                    
            //         const matchId = (await x.getAttribute('onclick')).split('\'').slice(-2, -1)[0].split('_').pop()
            //         await this.driver.get(`${this.URL}match/${matchId}`)
                    
            //         const goalsTimed = await Promise.all((await this.driver.findElements(By.css('.detailMS__headerScore'))).map(async y => (await y.getText()).replace(/\s/g, '').match(/(\d+)/g)))
            //         // const goalsTimed = (await this.driver.findElements(By.xpath('//*[@class="detailMS__headerScore"]/text()'))).map(y => y.replace(/\s/g, '').match(/(\d+)/g))
                    
            //         let first, second

            //         if (goalsTimed.length == 3 || goalsTimed.length == 2) {
            //             first = { goalsFirstTime: goalsTimed[0][0], goalsSecondTime: +goalsTimed[0][0] + +goalsTimed[1][0] }
            //             second = { goalsFirstTime: goalsTimed[0][1], goalsSecondTime: +goalsTimed[0][1] + +goalsTimed[1][1] }
            //             console.log('goalsTime', goalsTimed)
            //         } else if (goalsTimed.length == 1) {
            //             first = { filteredGoals: goalsTimed[0][0] }
            //             second = { filteredGoals: goalsTimed[0][1] }
            //             console.log('filteredGoals', goalsTimed)
            //         }
            //         // win lose draw
    
            //         const infoDict = {
            //             first: {
            //                 name: teams[0],
            //                 goals: goals[0],
            //                 ...first
            //             },
            //             second: {
            //                 name: teams[1],
            //                 goals: goals[1],
            //                 ...second
            //             },
            //             result: wld,
            //             timeOrStatus,
            //             matchId,
            //             matchUrl: `${this.URL}match/${matchId}`
            //         }
    
            //         matchesInfo.push(infoDict)
    
            //         return `${teams.join(' - ')} (${timeOrStatus})`
            //     } catch (e) {
            //         console.log(e)
            //         return ''
            //     }
            // }))

            const seriesMatchUrl = await this.driver.getCurrentUrl()
    
            const returnDict = {
                matches, strings, matchesInfo, teamNames, seriesMatchUrl, maxedOut
            }

            // console.log(returnDict)

            // return returnDict
            returnDicts.push(returnDict)
        }

        if (filterOptions.time !== 0) {
            for (const returnDict of returnDicts) {
                for (let matchElement of returnDict.matchesInfo) {
                    await this.driver.get(`${this.URL}match/${matchElement.matchId}`)
                    // await this.driver.sleep(1000)
                    await this.driver.wait(until.elementsLocated(By.css('.detailMS__headerScore')))
                    const scoresElement = await this.driver.findElements(By.css('.detailMS__headerScore'))
                    await this.driver.wait(until.elementTextMatches(scoresElement[0], /(\d+)/g))
                    // console.log(matchElement.matchUrl, scoresElement.length, scoresElement)
                    // await this.driver.wait(until.elementIsVisible(scoresElement))
                    const goalsTimed = await Promise.all(scoresElement.map(async y => (await y.getText()).replace(/\s/g, '').match(/(\d+)/g)))
                    // const goalsTimed = (await this.driver.findElements(By.xpath('//*[@class="detailMS__headerScore"]/text()'))).map(y => y.replace(/\s/g, '').match(/(\d+)/g))
    
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
                    // matchElement = {
                    //     ...matchElement,
                    //     first: {
                    //         ...matchElement.first,
                    //         ...first
                    //     },
                    //     second: {
                    //         ...matchElement.second,
                    //         ...second
                    //     }
                    // }
    
                }
            }

        } else {
            sendStatistics('series', 1, 1, 1)
        }

        return returnDicts


        // console.log('final', this.winLose(results))
        // console.log('final without draw', this.winLose(results, true))

        // console.log(results)
    }
    
    // historical data
    async goToTeamPages(matchUrl, filterOptions, analizeOptions, newElementFoundCallback, sendStatistics) {

        if (matchUrl) await this.driver.get(matchUrl)

        const teams = await this.driver.findElements(By.css('.tname .participant-imglink'))
        const teamUrls = await Promise.all(teams.map(async x => (await x.getAttribute('onclick')).split('\'')[1].slice(1)))
        const teamNames = await Promise.all(teams.map(async x => (await x.getText()).split('(')[0].trim()))
        
        // console.log(teamUrls)
        console.log(teamNames)
        // console.log(await this.driver.findElements(By.xpath('//*[@class="tname"]/*[@class="participant-imglink"]/@onclick')))

        // await Promise.all(teamUrls.map(async (x, ind) => await this.getAllMatchesOfTeam(`${this.URL}${x}/results`, teamNames[(ind + 1) % 2])))

        // teamUrls.forEach(async (x, ind) => await this.getAllMatchesOfTeam(`${this.URL}${x}/results`, teamNames[(ind + 1) % 2]))
        const results = []

        for (const [ind, x] of teamUrls.entries()) {
            sendStatistics('matches', 0, 1, teamUrls.length)

            let historicalSeriesMatch = { gamesAfterLimit: [] }

            if (filterOptions.needToParse[ind]) {
                historicalSeriesMatch = await this.getAllMatchesOfTeam(`${this.URL}${x}/results`, ind, teamNames, filterOptions, analizeOptions, sendStatistics)
                historicalSeriesMatch.matchUrl = `${this.URL}${x}/results`
    
                // TODO: do we need to remove element in case of one league search (&& !(filterOptions.league && filterOptions.league.length > 0))
                if (filterOptions.removeUnsafeMatch) {
                    // const sliceFromValue = historicalSeriesMatch.fullIndexes[0]
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

        return results
        // for (const team of await this.driver.findElements(By.css('.tname .participant-imglink'))) {
        //     console.log(team)
        //     const teamUrl = (await team.getAttribute('onclick')).split('\'')[1].slice(1)
        //     console.log(teamUrl)
        //     this.getAllMatchesOfTeam(`${this.URL}${teamUrl}`)
        // }
    }

    // historical data
    async getAllMatchesOfTeam(teamUrl, ind, teamNames, filterOptions, analizeOptions, sendStatistics) {
        await this.driver.get(teamUrl)
        // console.log('I am here.')

        const { performance } = require('perf_hooks')
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

            // console.log(await (await this.driver.findElements(By.css('.event__more')))[0].isEnabled())
            // console.log(!(showMore && (await showMore.isEnabled())))
            return !showMore || !(until.stalenessOf(showMore))
            // return !until.elementIsDisabled(By.css('.event__more'))
        })

            // const leagues = (await this.getLeagues()).map((x, i) => ({ name: x, index: i }))
            // const leaguesIndexes = leagues.filter(x => x.name === 'РОССИЯ: Премьер-лига').map(x => x.index)

            // console.log(leaguesIndexes.slice(0, 10))

            // const matches = await Promise.all(leaguesIndexes.slice(0, 10).map(async x => await this.getMatchesOfLeague(x + 1, false)))

        let matches = { matches: [], matchesInfo: [], strings: [] }
        if (filterOptions.leagues && filterOptions.leagues.length > 0) {
            let leagues = await this.getLeagues('.event__header')
            leagues = leagues.map(x => x.split('-')[0].trim().toLowerCase())

            const processedLeagues = filterOptions.leagues.map(x => x.split('-')[0].trim().toLowerCase())

            const leagueIndexes = leagues.map((x, i) => processedLeagues.some(y => x.startsWith(y)) ? i : -1).filter(x => x >= 0)

            console.log('check leagues', leagueIndexes.map(x => leagues[x]))
            // const leagueIndexes = leagues.map((x, i) => processedLeagues.includes(x) ? i : -1).filter(x => x >= 0)
            // const leagueIndexes = leagues.map((x, i) => processedLeagues.some(y => y.startsWith(x)) ? i : -1).filter(x => x >= 0)

            for (let i of leagueIndexes) {
                const newMatches = await this.getMatchesOfLeague(i + 1, false, false, 0, filterOptions.sliceNMatches, sendStatistics)
                matches = {
                    matches: [ ...matches.matches, ...newMatches.matches ],
                    matchesInfo: [ ...matches.matchesInfo, ...newMatches.matchesInfo ],
                    strings: [ ...matches.strings, ...newMatches.strings ],
                }
                sendStatistics('series', 0, 1, 1)
            }
        } else {
            matches = await this.getMatchesOfLeague(0, false, true, 0, filterOptions.sliceNMatches, sendStatistics)
            sendStatistics('series', 0, 1, 1)
        }
        // TODO:

        console.log('Matches length =', matches.matches.length)

        console.log('Elapsed time', performance.now() - time)

        const teamName = (await (await this.driver.findElements(By.css('.teamHeader__name')))[0].getText()).trim()

        console.log(teamName)

        // console.log(JSON.stringify(matches.matchesInfo, null, 4))
        // await this.analizeTeam(teamName, matches, opponentTeamName)
        console.log('analizy options', analizeOptions, ind)

        const filtered = this.filterGames(teamNames[0], matches, teamNames[1], filterOptions)
        return { ...this.analizeTeam(filtered, teamName, { ...analizeOptions, limit: analizeOptions.limit[ind] }), totalMatches: matches.matches.length }
        
    }

    // mode: ['winlose' (o[wld], wl, wd, ld), 'goals' (sumtotal, total, legup), 'hitgate' (both, onenot, onezero)]
    // arg - value for goals mode
    analizeTeam(filtered, teamName, options = { mode: 'winlose', sub: 'ow', limit: 0, arg: 0 }) {
        console.log('analizeOptions', options)
        // const games = [...filtered.matchesInfo]
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

            // console.log('sum of goals', games.map(x => +x.first.filteredGoals + +x.second.filteredGoals))
            // console.log('sum of goals', games.map(x => +x.first.filteredGoals + +x.second.filteredGoals).map(x => operationCompare(x, options.arg, options.operation) ? x : '-'))
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
        // const saveIndexes = reps.map((x, i) => ({ value: x, index: i })).filter(x => x.value > options.limit).map(x => x.index)

        const red = reps.reduce((a, b) => {
            if (b >= options.limit) {
                saveIndexes.push(a + Math.min(b, options.limit))
                fullIndexes.push(a + b)
                series.push(b)
            }
            return a + b + 1
        }, 0)

        // console.log(JSON.stringify(games, null, 4))

        // console.log(reps, saveIndexes)
        // console.log(saveIndexes, saveIndexes.map(x => games[x]))

        // console.log('games', games)
        
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

        // console.log('was', matches.matchesInfo)
        matches.matchesInfo = matches.matchesInfo.map(x => {
            const chooseGoals = (t) => options.time == 2 ? (t.goalsSecondTime || t.goals) - t.goalsFirstTime : options.time == 1 ? t.goalsFirstTime : t.goals
            if (x.first.filteredGoals === undefined && x.second.filteredGoals === undefined) {
                x.first.filteredGoals = chooseGoals(x.first)
                x.second.filteredGoals = chooseGoals(x.second)
            }
            return x
        })
        // console.log('become', matches.matchesInfo)
        
        return matches
    }

    winLose(results, withoutDraw = false, winOrLose = false) {

        const count = (results) => {
            const dict = { 'П': {}, 'В': {}, 'Н': {} }

            results.push(' ')

            // find a resultive char if first N are draws
            // let lastChar = results.find(x => x == 'П' || x == 'В') || 'Н'

            for (let i = 0, cx = 1; i < results.length - 1; i++) {
                dict[results[i]][cx] = (dict[results[i]][cx] || 0) + 1
                // if (results[i] != lastChar && results[i] != 'Н') {
                //     lastChar = results[i]
                // }
                if (results[i] == results[i + 1]) {
                    cx++
                } else {
                // } else if (results[i] == results[i + 1] && results[i + 1] != 'В') {
                    cx = 1
                }
            }
            // for (let i = 0, cx = 1; i < results.length - 1; i++) {
            //     if (!withoutDraw || results[i] != 'Н') {
            //         dict[results[i]][cx] = (dict[results[i]][cx] || 0) + 1
            //     }
            //     if (results[i] != results[i + 1] && (!withoutDraw || results[i + 1] != 'Н')) {
            //         cx = 1
            //     } else
            //     // if (results[i] == results[i + 1])
            //     {
            //         cx++
            //     }
            // }

            // console.log('pre', dict)

            // if (withoutDraw) delete dict['Н']

            return dict
        }

        const countWithoutDraw = () => {
            const d1 = this.winLose(results.join('').replace(/Н/g, 'В').split(''))
            const d2 = this.winLose(results.join('').replace(/Н/g, 'П').split(''))
            
            return { 'В': d1['В'], 'П': d2['П'] }
        }

        const countWinOrLose = () => {
            const dict = { 'В': {}, 'П': {} }
            results.join('').split('Н').map(x => x.length).filter(x => x !== 0).map(x => [...Array(x).keys()].map(i => dict['В'][i + 1] = (dict['В'][i + 1] || 0) + 1))

            dict['П'] = dict['В']

            return dict
        }

        if (winOrLose) {
            return countWinOrLose()
        }
        return withoutDraw ? countWithoutDraw() : count([...results])
    }

    async getMatchIdArray(...args) {
        const matchesId = await Promise.all((await this.getMatchesOfLeague(...args)).matches.map(async match => (await match.getAttribute('id')).split('_').pop()))

        return matchesId
    }

    // find teams firing a series streak NOW
    async findSeriesForLeague(leagueIndex, filterOptions, analizeOptions, newElementFoundCallback, sendStatistics) {
        if (await this.driver.getCurrentUrl() !== this.URL) await this.driver.get(this.URL)
        // this.getLeagues() 
        const fitTeams = []
        // const matchesInOneLeague = await this.getMatchesOfLeague(3)
        console.log('allMatches', filterOptions.allMatchesSearch)
        const matchesId = await this.getMatchIdArray(leagueIndex, ...(filterOptions.allMatchesSearch ? [true, true] : []))
        console.log('matchesId', matchesId)
        console.log(matchesId.length)
        for (let i = 1; i < matchesId.length + 1; i++) {
            // if (i != 1) await this.driver.get(this.URL)
            await this.getMatch(0, i, matchesId)

            sendStatistics('matches', 0, 1, matchesId.length)
            // await this.driver.sleep(2000)
            let numberOfSeries = 0, limitFrom = 0, seriesMaxedOut = false, seriesAccumulator = [{ matchesInfo: [] }, { matchesInfo: [] }]

            while (numberOfSeries < 2 && !seriesMaxedOut) {
                var checkingForSeriesStartMatches = await this.checkTimeGoals(filterOptions.leagues, limitFrom, analizeOptions.limitTo + limitFrom, filterOptions, sendStatistics)
                // console.log('check', checkingForSeriesStartMatches)
                console.log('options', filterOptions, analizeOptions)

                var filtered = [], analizedGames = []

                for (const [index, match] of checkingForSeriesStartMatches.entries()) {

                    seriesAccumulator[index].matchesInfo = [ ...seriesAccumulator[index].matchesInfo, ...match.matchesInfo ]
                    // console.log(seriesAccumulator, index, seriesAccumulator[index])

                    filtered.push(this.filterGames(match.teamNames[0], seriesAccumulator[index], match.teamNames[1], filterOptions))
                    // console.log(filtered)
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
                console.log('yes yes')

                const lastSeriesGame = {
                    first: { name: checkingForSeriesStartMatches[0].teamNames[0] },
                    second: { name: checkingForSeriesStartMatches[0].teamNames[1] },
                    series: analizedGames.map(x => x.reps.slice(-1)[0]),
                    matchUrl: checkingForSeriesStartMatches[0].seriesMatchUrl
                    // ...analizedGames.gamesAfterLimit.slice(-1)[0]
                }
                // const lastSeriesGame = {
                //     series: analizedGames.map(x => x.reps.slice(-1)[0]),
                //     ...filtered[0].matchesInfo.slice(-1)[0]
                //     // ...analizedGames.gamesAfterLimit.slice(-1)[0]
                // }
                
                fitTeams.push(lastSeriesGame)
                
                newElementFoundCallback({
                    first: { name: checkingForSeriesStartMatches[0].teamNames[0] },
                    second: { name: checkingForSeriesStartMatches[0].teamNames[1] },
                    series: analizedGames.map(x => x.reps.slice(-1)[0]),
                    matchUrl: checkingForSeriesStartMatches[0].seriesMatchUrl
                })
            }

            // return analizedGames
        }

        // console.log(fitTeams)

        return fitTeams

        // for (const matchUrl of fitTeams) {
        //     console.log(matchUrl)
        //     await this.goToTeamPages(matchUrl)    
        // }

        // await Promise.all(fitTeams.map(async matchUrl => {
        //     // await this.driver.get(matchUrl)
        //     console.log(matchUrl)
        //     await this.goToTeamPages(matchUrl)
        // }))
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