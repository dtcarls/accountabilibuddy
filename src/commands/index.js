import * as buddy from './buddy.js';
import * as checkin from './checkin.js';
import * as gallery from './gallery.js';
import * as help from './help.js';
import * as leaderboard from './leaderboard.js';
import * as pledge from './pledge.js';
import * as profile from './profile.js';
import * as setup from './setup.js';

export const commands = [checkin, checkin.undo, buddy, pledge, profile, gallery, leaderboard, setup, help];
