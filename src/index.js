const fs = require('fs');
const chokidar = require('chokidar');
const SFTPClient = require('ssh2-sftp-client');
const clipboardy = require('clipboardy');
const notifier = require('node-notifier');
const sharp = require('sharp');
const {promisify} = require('util');
const config = require('./config');

const readFile = promisify(fs.readFile);

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
	let buffer = await readFile(path);
	buffer = await normalizeBuffer(buffer);

	const filename = `${timestamp()}-${randomString()}.png`;

	const sftp = await getSftp();
	await sftp.put(buffer, `${config.sftpPath}/${filename}`);

	const publicLink = `${config.viewPath}/${filename}`;

	clipboardy.writeSync(publicLink);
	console.log(`[READY] ${publicLink}`);
	notifier.notify({title: 'scrscr', message: publicLink, icon: publicLink});
}

async function main() {
	const listener = chokidar.watch(
		`${config.screensDir}/*.png`,
		{persistent: true, ignoreInitial: true},
	);

	listener.on('add', onScreenReceived);
}

main();
