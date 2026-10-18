// Every icon, by the name the app uses (src/illustrations/Art3D.tsx).
import { PEOPLE_ICONS } from './people.js'
import { SERVICE_ICONS } from './services.js'
import { THING_ICONS } from './things.js'

export const ICONS = { ...SERVICE_ICONS, ...THING_ICONS, ...PEOPLE_ICONS }
