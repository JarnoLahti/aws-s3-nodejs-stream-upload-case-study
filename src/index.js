import http from 'http';
import fs from 'fs';
import path from 'path';
import Busboy from 'busboy';
import { ManagedDownloader } from '@aws/s3-managed-downloader';
import * as AWS from 'aws-sdk';

const port = process.env.PORT || 3000;

if (!process.env.AWS_S3_BUCKET_NAME) {
  throw Error("NO 'AWS_S3_BUCKET_NAME' DEFINED IN ENVIRONMENT: define it in .env file which should be found from root of this project");
}

const s3 = new AWS.S3({ region: 'eu-central-1', apiVersion: '2006-03-01' });
s3.config.logger = console;
const downloader = new ManagedDownloader(s3);

const AWS_S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

const s3Upload = async (fileStream, fileName) => {
  await s3.upload({ Bucket: AWS_S3_BUCKET_NAME, Key: fileName, Body: fileStream }, { partSize: 10 * 1024 * 1024 }).promise();
};

const s3Download = async (key) => {
  return await downloader.getObjectStream({
    Bucket: AWS_S3_BUCKET_NAME,
    Key: key,
  });
};

const handlePosts = (req, res) => {
  var busboy = new Busboy({ headers: req.headers });
  busboy.on('file', (fieldname, file, filename, encoding, mimetype) => s3Upload(file, filename));
  busboy.on('finish', function () {
    res.end();
  });
  req.pipe(busboy);
};

const handleGetObjects = async (res) => {
  const getResult = await s3.listObjects({ Bucket: AWS_S3_BUCKET_NAME, MaxKeys: 10 }).promise();
  res.end(JSON.stringify(getResult.Contents.map((c) => c.Key)));
};

const handleDownload = async (id, res) => {
  const stream = await s3Download(id);
  res.setHeader('Content-disposition', `attachment;filename=${id}`);
  res.setHeader('Content-Length', stream.contentLength);
  res.setHeader('Content-type', stream.mimeType);
  stream.pipe(res);
};

const handleDeleteObject = async (id, res) => {
  await s3.deleteObject({ Bucket: AWS_S3_BUCKET_NAME, Key: id }).promise();
  res.end();
};

const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    handlePosts(req, res);
    return;
  }
  if (req.method === 'DELETE' && req.url.includes('/delete')) {
    const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const id = query.get('id');
    handleDeleteObject(id, res);
  }
  if (req.method === 'GET' && req.url === '/objects') {
    handleGetObjects(res);
    return;
  }
  if (req.method === 'GET' && req.url.includes('/download')) {
    const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const id = query.get('id');
    handleDownload(id, res);
    return;
  }
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.statusCode = 200;
    fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  }
});

server.listen(port);
