import { AxiosInstance } from "axios";
import moment from "moment";
import QueryString from "qs";
import { createWorker } from "tesseract.js";
import { CookieJar } from "tough-cookie";
import Functions from "../util/Functions";
import createSession from "../util/Session";
import Formatter from "./Formatter";

class OneCard {
    public permission = 'OneCard'

    private studentId?: string
    private password?: string
    private session: AxiosInstance

    constructor(studentId?: string, password?: string, cookieJarJson?: string) {
        this.studentId = studentId
        this.password = password
        this.session = createSession(cookieJarJson ? CookieJar.fromJSON(cookieJarJson) : undefined)
    }

    public static fromCookieJar(cookieJarJson: string) {
        return new this(undefined, undefined, cookieJarJson)
    }

    public static fromUserPass(studentId: string, password: string) {
        return new this(studentId, password, undefined)
    }

    private async captcha() {
        const url = 'http://ykt.zstu.edu.cn/SelfSearch/validateimage.ashx'
        let captcha = undefined
        while (!Functions.isNumber(captcha)) {
            const res = await this.session({
                url: url,
                method: 'get',
                responseType: 'arraybuffer',
                validateStatus: () => true
            }).then(value => {
                return value.data
            })
            const worker = createWorker()
            await worker.load()
            await worker.loadLanguage('eng')
            await worker.initialize('eng')
            captcha = (await worker.recognize(res)).data.text
            await worker.terminate()
            return captcha
        }
    }

    /* ViewState & ViewStateGenerate & EventValidation */
    private async getEssentials(res: string) {
        const pageSource = res?.startsWith('http') ? await this.session({url: res}).then(value => value.data) : res
        const viewStateReg = /id=\"__VIEWSTATE\" value=\"(.*?)\"/
        const viewStateGenerateReg = /id=\"__VIEWSTATEGENERATOR\" value=\"(.*?)\"/
        const eventValidationReg = /id=\"__EVENTVALIDATION\" value=\"(.*?)\"/
        return {
            viewState: viewStateReg.exec(pageSource)?.at(1),
            viewStateGenerate: viewStateGenerateReg.exec(pageSource)?.at(1),
            eventValidation: eventValidationReg.exec(pageSource)?.at(1)
        }
    }

    public async testIfLogined() {
        const url = 'http://ykt.zstu.edu.cn'
        const res = await this.session({
            url: url
        }).then(value => value.data)
        if (res.match('用户登录')) {
            return false
        }
        return true
    }

    public async login() {
        if (await this.testIfLogined()) {
            return
        }
        const url = 'http://ykt.zstu.edu.cn/SelfSearch/login.aspx'
        const essentials = await this.getEssentials(url)
        for (let cnt = 0; cnt < 5; ++cnt) {
            const payload = {
                __LASTFOCUS: '',
                __EVENTTARGET: 'btnLogin',
                __EVENTARGUMENT: '',
                __VIEWSTATE: essentials.viewState,
                __VIEWSTATEGENERATOR: essentials.viewStateGenerate,
                __EVENTVALIDATION: essentials.eventValidation,
                txtUserName: this.studentId,
                txtUserNameJiaMi: '',
                txtPassword: this.password,
                txtVaildateCode: await this.captcha(),
                hfIsManager: 0
            }
            await this.session({
                url: url,
                method: 'post',
                data: QueryString.stringify(payload),
                validateStatus: () => true
            }).then(value => {
                return value.data
            })
            if (await this.testIfLogined()) {
                return
            }
        }
        /* If not returned above, it must be somethings went wrong */
        throw Error('Failed atfer 5 logins')
    }

    public getCookieJar() {
        return this.session.defaults.jar
    }

    public async getBalance() {
        const url = 'http://ykt.zstu.edu.cn/SelfSearch/User/Home.aspx'
        const res = await this.session({
            url: url
        }).then(value => {
            return value.data
        })
        return Formatter.Balace(res)
    }

    private async doQuery(url: string, startDate?: string, endDate?: string) {
        let essentials = await this.getEssentials(url)
        const payload: any = {
            __EVENTTARGET: '',
            __EVENTARGUMENT: '',
            __VIEWSTATE: essentials.viewState,
            __VIEWSTATEGENERATOR: essentials.viewStateGenerate,
            __EVENTVALIDATION: essentials.eventValidation,
            ctl00$ContentPlaceHolder1$rbtnType: '0',
            ctl00$ContentPlaceHolder1$txtStartDate: '',
            ctl00$ContentPlaceHolder1$txtEndDate: '',
            ctl00$ContentPlaceHolder1$btnSearch: '查  询'
        }

        const date = new Date()
        const now = endDate || moment(date).format('yy-MM-DD')
        const pas = startDate ||moment(date.setDate(date.getDate() - 30)).format('yy-MM-DD')
        payload.ctl00$ContentPlaceHolder1$txtStartDate = pas
        payload.ctl00$ContentPlaceHolder1$txtEndDate = now

        let res: string, result: string = ''
        while (true) {
            res = await this.session({
                url: url,
                method: 'post',
                data: QueryString.stringify(payload),
                validateStatus: () => true
            }).then(value => value.data)
            essentials = await this.getEssentials(res)
            if (payload.__EVENTVALIDATION == essentials.eventValidation) {
                break
            }
            payload.__EVENTTARGET = 'ctl00$ContentPlaceHolder1$AspNetPager1'
            payload.__EVENTARGUMENT = (payload.__EVENTARGUMENT == '') ?  '2' : String(parseInt(payload.__EVENTARGUMENT) + 1)
            payload.__VIEWSTATE = essentials.viewState
            payload.__VIEWSTATEGENERATOR = essentials.viewStateGenerate
            payload.__EVENTVALIDATION = essentials.eventValidation
            payload.ctl00$ContentPlaceHolder1$btnSearch ? delete payload.ctl00$ContentPlaceHolder1$btnSearch : undefined
            result += res
        }
        return result
    }

    public async getConsumption(startDate?: string, endDate?: string) {
        const url = 'http://ykt.zstu.edu.cn/SelfSearch/User/ConsumeInfo.aspx'
        const res = await this.doQuery(url, startDate, endDate)
        return Formatter.Consumption(res)
    }

    public async getAttendance(startDate?: string, endDate?: string) {
        const url = 'http://ykt.zstu.edu.cn/SelfSearch/User/OriginalRecord.aspx'
        const res = await this.doQuery(url, startDate, endDate)
        return Formatter.Attendance(res)
    }
}

export default OneCard