import rawData from '../tuf-spec-data.json'
import { validateSpecData } from './validate'

export const specData = validateSpecData(rawData)
