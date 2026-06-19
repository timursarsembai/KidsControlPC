import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildScreenshotFailureMessage,
  getScreenshotOutputDir,
  normalizeNumber
} from './screenshotCapture.js'

const tempFiles = []

function tempOutputPath() {
  const filePath = path.join(os.tmpdir(), `kc-screenshot-test-${Date.now()}-${Math.random()}.jpg`)
  tempFiles.push(filePath, `${filePath}.error.txt`)
  return filePath
}

afterEach(() => {
  for (const filePath of tempFiles.splice(0)) {
    try { fs.unlinkSync(filePath) } catch {}
  }
})

describe('screenshotCapture', () => {
  it('normalizes numeric screenshot settings', () => {
    expect(normalizeNumber('2000', 1280, 320, 3840)).toBe(2000)
    expect(normalizeNumber('bad', 1280, 320, 3840)).toBe(1280)
    expect(normalizeNumber(10, 1280, 320, 3840)).toBe(320)
    expect(normalizeNumber(5000, 1280, 320, 3840)).toBe(3840)
  })

  it('uses ProgramData for the screenshot output directory when available', () => {
    const previousProgramData = process.env.ProgramData
    process.env.ProgramData = 'C:\\ProgramData'

    expect(getScreenshotOutputDir()).toBe('C:\\ProgramData\\KidsControlPC\\Screenshots')

    if (previousProgramData === undefined) delete process.env.ProgramData
    else process.env.ProgramData = previousProgramData
  })

  it('includes helper error text in capture failure messages', () => {
    const outputPath = tempOutputPath()
    fs.writeFileSync(`${outputPath}.error.txt`, 'Invalid handle', 'utf8')

    expect(buildScreenshotFailureMessage(outputPath)).toBe('Screenshot helper did not produce output: Invalid handle')
  })
})
