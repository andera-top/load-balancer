import express, { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'

export const defaultController: Router = express.Router()

defaultController.get('/', (req: Request, res: Response) => {
  res.send(`<!DOCTYPE html>
  <html lang=\"fr\">
  <head>
    <meta charset=\"UTF-8\">
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
    <title>Andera – Task Orchestration Platform (TOP)</title>
    <style>
      html, body {
        background: white;
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
      }
      a {
        display: block;
        overflow: hidden;
        width: 240px;
        height: 382px;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        margin: 0;
        padding: 0;
        text-indent: -100vw;
        overflow: hidden;
        background-image: url('/assets/images/andera.svg');
        background-repeat: no-repeat;
        background-position: top center;
        background-size: contain;
      }
      a::after {
        content: "";
        position: absolute;
        left: 0;
        bottom: 0;
        width: 100%;
        height: 74px;
        background-image: url('/assets/images/title.svg');
        background-repeat: no-repeat;
        background-position: bottom center;
        background-size: contain;
      }
    </style>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    </head>
  <body>
    <a href=\"https://andera.top\">Andera – Task Orchestration Platform (TOP)</a>
  </body>
  </html>`)
})

defaultController.get('/favicon.svg', (req: Request, res: Response) => {
  const filePath = path.join(__dirname, '../../assets/images/andera.svg')
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) return res.status(404).send('Not found')
    const favicon = data.replace('width="502.553" height="586.376"', 'viewBox="0 0 586.376 586.376" width="128" height="128"')
    res.type('image/svg+xml').send(favicon)
  })
})
