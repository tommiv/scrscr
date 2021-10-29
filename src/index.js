import fs from 'fs';
import child_process from 'child_process';
import {promisify} from 'util';
import chokidar from 'chokidar';
import SFTPClient from 'ssh2-sftp-client';
import clipboardy from 'clipboardy';
import imgclibboard from 'img-clipboard';
import notifier  from 'node-notifier';
import sharp from 'sharp';
import config from './config.js';

const exec = promisify(child_process.exec);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);

function timestamp() {
	const dt = new Date();
	return [
		dt.getFullYear().toString().substring(2),
		(dt.getMonth() + 1).toString().padStart(2, '0'),
		dt.getDate().toString().padStart(2, '0'),
	].join('');
}

function randomString(length = 5) {
	return Math.random().toString(36).substring(2, 2 + length);
}

async function detectScreensDir() {
	const {stdout} = await exec('defaults read com.apple.screencapture location');
	return (stdout || '').replace(/\s/g, '');
}

async function getSftp() {
	const sftp = new SFTPClient();
	await sftp.connect({
		host:     config.sftpHost,
		username: config.sftpUser,
		password: config.sftpPass,
	});
	return sftp;
}

async function normalizeBuffer(buffer) {
	if (!config.downscale) {
		return buffer;
	}

	const wrapper = sharp(buffer);
	const meta = await wrapper.metadata();

	// NB: can we rely on this?
	if (meta.density < 100) {
		return buffer;
	}

	const dim = {
		width:  Math.floor(meta.width / 2),
		height: Math.floor(meta.height / 2),
	};

	return await wrapper.resize(dim).toBuffer();
}

async function onScreenReceived(path) {
	if (config.action === 'clipboard') {
		await imgclibboard.copyImg(path);
		console.log(`[COPIED] ${path}`)
	} else if (config.action === 'upload') {
		let buffer = await readFile(path);
		buffer = await normalizeBuffer(buffer);

		const filename = `${timestamp()}-${randomString()}.png`;

		try {
			const sftp = await getSftp();
			await sftp.put(buffer, `${config.sftpPath}/${filename}`);
		} catch(e) {
			console.error(`[ERROR] Upload failed: ${e.message}`);
			notifier.notify({title: 'scrscr', message: `Upload failed: ${e.message}`});
			return;
		}

		const publicLink = `${config.viewPath}/${filename}`;

		clipboardy.writeSync(publicLink);
		console.log(`[UPLOADED] ${publicLink}`);
		notifier.notify({title: 'scrscr', message: publicLink, contentImage: path});
	}

	if (config.remove) {
		await unlink(path);
	}
}

async function main() {
	const dirToWatch = config.screensDir || await detectScreensDir();
	console.log(`[WATCH] ${dirToWatch}/*.png`);

	const listener = chokidar.watch(
		`${dirToWatch}/*.png`,
		{persistent: true, ignoreInitial: true},
	);

	listener.on('add', onScreenReceived);
}

process.on('unhandledRejection', (reason, promise) => {
	console.log('Unhandled Rejection at:', promise, 'reason:', reason);
	notifier.notify({title: 'scrscr', message: 'Unhandled rejection, check the console'});
});

main();
