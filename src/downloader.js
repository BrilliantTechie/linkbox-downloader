// import { error } from "console";
import fs from "fs"
import Downloader from "nodejs-file-downloader"
import path from "path"
import { URL } from "url"
import paths from "./paths.js"
import fetch from "node-fetch"
import {
	parseConfigsFile,
	generateProxyUrl,
	createProxyAgent,
} from "./helpers.js"

// const generateMainDirectoryLink = (folderId) =>
// 	`https://www.linkbox.to/api/file/share_out_list/?pageSize=50&shareToken=${folderId}&pid=0`;

const generateSubFolderOrFileLink = (shareToken, pid) =>
	`https://www.linkbox.to/api/file/share_out_list/?pageSize=50&shareToken=${shareToken}&pid=${pid}`

const generateFolderBaseInfoLink = pid =>
	`https://www.linkbox.to/api/file/folder_base_info?dirId=${pid}&lan=en`

const createProxiesAgents = function* () {
	const configs = parseConfigsFile()
	const proxies = JSON.parse(configs["proxies"] || null)
	if (!proxies) {
		return { proxyAgent: null, proxyIndex: null }
	} else {
		let i = 0
		while (true) {
			if (i >= proxies.length) i = 0
			const proxy = proxies[i]
			const proxyUrl = generateProxyUrl(proxy)
			yield { proxyAgent: createProxyAgent(proxyUrl), proxyIndex: i }
			i++
		}
	}
}

const roundedProxiesCreator = createProxiesAgents()

export function sanitizeFileName(filename) {
	// Regular expression to match invalid characters for Windows file names
	const illegalRe = /[\/\?<>\\:\*\|":]/g;
	const controlRe = /[\x00-\x1f\x80-\x9f]/g;
	const reservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
	const windowsReservedRe = /[<>:"\/\\|?*\x00-\x1F\x80-\x9F]/g;
	const windowsTrailingRe = /[\. ]+$/;

	// Replace illegal characters with an underscore
	let sanitized = filename
		.replace(illegalRe, '_')
		.replace(controlRe, '_')
		.replace(windowsReservedRe, '_')
		.replace(windowsTrailingRe, '');

	// Ensure the filename doesn't match any reserved names
	if (reservedRe.test(sanitized)) {
		sanitized = '_' + sanitized;
	}

	return sanitized;
}

const getData = async function (url) {
	try {
		//const { proxyAgent, proxyIndex } = roundedProxiesCreator.next().value

		const res = await fetch(url, { /*agent: proxyAgent*/ })

		if (res.status == 407 && proxyAgent) {
			const error = new Error("Proxy Authentication Required")
			error.cancelationMessage = `Couldn't complete the fetch process, the proxy number '${
				proxyIndex + 1
			}' in your proxies list requires auth. Go to configs and check it.`
			throw error
		}

		const data = await res.json()
		return data
	} catch (error) {
		if (!error.cancelationMessage)
			error.cancelationMessage =
				"Couldn't complete the fetch process, make sure that you're connected and LinkBox is available."
		throw error
	}
}

const parseListPIDs = list => {
	const foldersList = list
	foldersList.sort((a, b) => {
		if (a.name_sort > b.name_sort) return 1
		else if (a.name_sort < b.name_sort) return -1
		else return 0
	})

	return foldersList.map(item => {
		const element = {}
		// element.name = item.name.trim();
		element.type = item.type
		element.pid = item.id
		// if (item.type == "dir") {
		// 	// element.name =
		// } else
		const numericName = item.name.replace(/الحلقة|الموسم/, "")
		// const numericName = item.name.replace("الحلقة", "");
		if (item.type == "video") {
			element.name = "E" + parseInt(numericName)
			element.url = item.url
		} else if (item.type == "dir") {
			element.name = "Season " + parseInt(numericName)
		}

		return element
	})
}

const clearLastLine = () => {
	process.stdout.moveCursor(0, -1) // up one line
	process.stdout.clearLine(1) // from cursor to end
}

const generateFilePath = args => {
	// handle path commom issues
	args = args.map(arg => arg.trim())
	return path.join(...args) //.replaceAll(" ", "_");
}

const isEpisodeDownloaded = filePath => {
	// const filePath = path.join(...args);
	// console.log(filePath);
	return !!fs.existsSync(filePath)
}

const downloadFile = async (
	url,
	dirPath,
	dirName = "general",
	fileName = "undefined"
) => {
	console.log(`   ⏳ Downloading ${fileName} of ${dirName}.`)
	// console.log({ dirPath, fileName });
	console.log(``)

	dirName = sanitizeFileName(dirName);
	fileName = sanitizeFileName(fileName);
	const downloader = new Downloader({
		url,
		maxAttempts: 3,
		directory: dirPath,
		fileName: fileName,
		// onBeforeSave: (deducedName) => {
		// 	// add file extension to it if no extension put at the end
		// 	const ext = deducedName.split(".").pop();
		// 	return ext == fileExtension ? fileName : fileName + "." + fileExtension;
		// },
		onProgress: function (percentage, chunk, remainingSize) {
			clearLastLine()
			console.log(
				`      %${percentage} / Remaining: ${(
					remainingSize /
					(1024 * 1024)
				).toFixed(2)}MB`
			)
			// console.log("  Remaining bytes: ", remainingSize);
		},
	})
	try {
		const { filePath, downloadStatus } = await downloader.download()
		clearLastLine()
		clearLastLine()
		console.log(`   ✅ ${fileName} of ${dirName} is downloaded.`)
	} catch (error) {
		error.cancelationMessage =
			"Couldn't download files, make sure that you're connected and LinkBox is available."
		throw error
	}
}

export const parseLink = link => {
	const url = new URL(link)
	const [mainPart] = link.split("?")
	const shareToken = mainPart.split("/").pop()
	// console.log(link);
	// console.log(url);
	// console.log(queryPart);
	const pid = url.search && url.searchParams.get("pid")
	// const pid = queryPart && URL
	return { shareToken, pid }
}

export const getAllDownloadLinks = async (shareToken, pid) => {
	const requestLink = generateSubFolderOrFileLink(shareToken, pid)
	const responseJSON = await getData(requestLink)
	// // console.log(requestLink);
	// // console.log(responseJSON);
	// return responseJSON;

	const contentList = extractResponseContentList(responseJSON)
	// console.log(contentList);
	const parsedList = await recursiveCascadeToLeastFile(contentList)
	// console.log(parsedList);
	// console.log(parsedList[0]);

	// const parsedList = parseListPIDs(responseJSON.data.list);
	// const completeList = await cascadeToLeastVideo(parsedList);
	// console.log(completeList[0].sub);

	function extractResponseContentList(responseJSON) {
		if (responseJSON.data) return responseJSON.data.list
		// } catch (error) {
		const error = new Error("Make sure that link is right!")
		error.cancelationMessage = `Make sure that link is right!`
		throw error
		// }
		// throw
	}

	async function recursiveCascadeToLeastFile(list) {
		if (!list || list.constructor.name !== "Array") return

		list.sort((a, b) => {
			if (a.name_sort > b.name_sort) return 1
			else if (a.name_sort < b.name_sort) return -1
			else return 0
		})

		const completeList = []

		for (const pidObject of list) {
			const neededPidObject = {
				type: pidObject.type,
				name: pidObject.name,
			}
			if (pidObject.type === "dir") {
				neededPidObject.id = pidObject.id

				const requestLink = generateSubFolderOrFileLink(
					shareToken,
					pidObject.id
				)
				const responseJSON = await getData(requestLink)
				const contentList = extractResponseContentList(responseJSON)
				const parsedList = await recursiveCascadeToLeastFile(contentList)
				completeList.push({ ...neededPidObject, sub: parsedList })
			} else {
				neededPidObject.url = pidObject.url
				neededPidObject.extension = pidObject.sub_type || ""
				neededPidObject.item_id = pidObject.item_id
				completeList.push(neededPidObject)
			}
		}
		return completeList
	}

	return parsedList
}

export const saveFetchedUrls = async (baseFolderName, url, parsedList) => {
	// console.log(parsedList);

	const now = new Date()
	// const now = new Date().toString();
	const metadata = {
		date: now.toLocaleString(),
		directory_name: baseFolderName,
		directory_url: url,
		files: parsedList,
	}
	// console.log(metadata);

	try {
		const logDirectory = paths.logs

		// console.log(now);
		const filePath = path.join(
			logDirectory,
			`linkbox_log.${now.toISOString()}.json`.replace(/:/g, "_")
		)
		fs.writeFile(filePath, JSON.stringify(metadata), "utf8", () => {})
		// console.log("saveFetchedUrls");
	} catch (error) {
		error.cancelationMessage = `Couldn't save to a log file, make sure that you can access this directory './linkbox_logs'.`
		throw error
	}
}

export const getBaseFolderName = async pid => {
	const requestLink = generateFolderBaseInfoLink(pid)
	const responseJSON = await getData(requestLink)
	// console.log(responseJSON.data.name);
	return responseJSON.data.name
}

export default async function downloadDirectory(
	initialPathDirectory,
	completeList,
	baseDirectoryName
) {
	baseDirectoryName = sanitizeFileName(baseDirectoryName);
	// console.log({ initialPathDirectory, baseDirectoryName });
	for (const pidObject of completeList) {
		// console.log(path);
		const dirPath = generateFilePath([
			...initialPathDirectory,
			baseDirectoryName,
		])
		if (pidObject.sub) {
			// pidObject is a folder
			await downloadDirectory([dirPath], pidObject.sub, pidObject.name)
		} else {

			const fileName = function () {
				const ext = pidObject.name.split(".").pop()
				return ext == pidObject.extension
					? pidObject.name
					: pidObject.name + "." + pidObject.extension
			}()
			const filePath = generateFilePath([
				...initialPathDirectory,
				baseDirectoryName,
				fileName,
			])
			// pidObject is a file
			if (!isEpisodeDownloaded(filePath)) {
				await downloadFile(pidObject.url, dirPath, baseDirectoryName, fileName)
			} else {
				console.log(
					`   ✅ ${fileName} of ${baseDirectoryName} was downloaded in a previous session.`
				)
			}
		}

		// for (const episode of season.sub) {
		// 	const fileName =
		// 		"S" +
		// 		parseInt(season.name.replace("Season", "")) +
		// 		episode.name +
		// 		".mp4";
		// 	if (!isEpisodeDownloaded(season.name, fileName)) {
		// 		await downloadFile(episode.url, season.name, episode.name);
		// 	} else {
		// 		console.log(
		// 			`✅ ${episode.name} of ${season.name} was downloaded in a previous session.`
		// 		);
		// 	}
		// }
	}
}

export const exportedForTesting = {
	generateSubFolderOrFileLink,
	generateFolderBaseInfoLink,
	getData,
	generateFilePath,
	clearLastLine,
	isEpisodeDownloaded,
}
