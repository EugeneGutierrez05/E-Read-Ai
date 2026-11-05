// Phase 1 sample catalog: public-domain works hosted by Project Gutenberg (legally downloadable).
// Phase 2 will extend this to 200+ unique books (see docs/PHASE1_TECHNICAL_DOCUMENTATION.md).
const db = require('./db');
const bcrypt = require('bcryptjs');

const G = (id) => `https://www.gutenberg.org/ebooks/${id}`;
const C = (id) => `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`;

const books = [
  ['Pride and Prejudice', 'Jane Austen', 'Romance', 1342, 1813, 'A witty novel of manners following Elizabeth Bennet and Mr. Darcy.'],
  ['Emma', 'Jane Austen', 'Romance', 158, 1815, 'A young matchmaker learns about her own heart in Regency England.'],
  ['Frankenstein', 'Mary Wollstonecraft Shelley', 'Science Fiction', 84, 1818, 'A scientist creates life and faces the consequences.'],
  ['Dracula', 'Bram Stoker', 'Horror', 345, 1897, 'The classic vampire tale told through letters and diaries.'],
  ['The Time Machine', 'H. G. Wells', 'Science Fiction', 35, 1895, 'A Victorian inventor travels to the distant future.'],
  ['The War of the Worlds', 'H. G. Wells', 'Science Fiction', 36, 1898, 'Martians invade England in this pioneering sci-fi novel.'],
  ['Alice\'s Adventures in Wonderland', 'Lewis Carroll', 'Fantasy', 11, 1865, 'Alice tumbles down a rabbit hole into a world of nonsense.'],
  ['The Adventures of Sherlock Holmes', 'Arthur Conan Doyle', 'Mystery', 1661, 1892, 'Twelve classic cases of the world\'s greatest detective.'],
  ['Moby Dick; Or, The Whale', 'Herman Melville', 'Adventure', 2701, 1851, 'Captain Ahab\'s obsessive hunt for the white whale.'],
  ['The Adventures of Tom Sawyer', 'Mark Twain', 'Adventure', 74, 1876, 'A mischievous boy grows up along the Mississippi.'],
  ['Treasure Island', 'Robert Louis Stevenson', 'Adventure', 120, 1883, 'Pirates, maps, and buried treasure.'],
  ['The Art of War', 'Sun Tzu', 'Philosophy', 132, -500, 'Ancient Chinese treatise on strategy and leadership.'],
  ['Meditations', 'Marcus Aurelius', 'Philosophy', 2680, 180, 'Private reflections of a Roman emperor on Stoic living.'],
  ['The Prince', 'Niccolo Machiavelli', 'Politics', 1232, 1532, 'A foundational treatise on political power.'],
  ['Noli Me Tangere', 'Jose Rizal', 'Classic Literature', 6737, 1887, 'Rizal\'s landmark novel of colonial Philippines.'],
  ['The Count of Monte Cristo', 'Alexandre Dumas', 'Adventure', 1184, 1844, 'A wrongfully imprisoned man plots his revenge.'],
  ['Great Expectations', 'Charles Dickens', 'Classic Literature', 1400, 1861, 'Pip\'s journey from poor orphan to gentleman.'],
  ['Crime and Punishment', 'Fyodor Dostoyevsky', 'Classic Literature', 2554, 1866, 'A student\'s murder and psychological unraveling.'],
  ['The Picture of Dorian Gray', 'Oscar Wilde', 'Classic Literature', 174, 1890, 'A portrait ages while its subject stays young.'],
  ['Wuthering Heights', 'Emily Bronte', 'Romance', 768, 1847, 'A turbulent love story on the Yorkshire moors.'],
];

const insert = db.prepare(`INSERT OR IGNORE INTO books
  (title, author, category, description, cover_url, download_url, license, source, year)
  VALUES (?,?,?,?,?,?, 'Public Domain', 'Project Gutenberg', ?)`);

function seed() {
  const tx = db.transaction(() => {
    for (const [t, a, c, id, y, d] of books) insert.run(t, a, c, d, C(id), G(id), y);
    // Default administrator (CHANGE THE PASSWORD via env in production)
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@elibrary.local';
    const adminPass = process.env.ADMIN_PASSWORD || 'Admin@12345';
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
    if (!exists) {
      db.prepare('INSERT INTO users (full_name,email,password_hash,role) VALUES (?,?,?,?)')
        .run('Library Administrator', adminEmail, bcrypt.hashSync(adminPass, 10), 'admin');
    }
  });
  tx();
}

module.exports = { seed };
if (require.main === module) { seed(); console.log('Seeded', db.prepare('SELECT COUNT(*) n FROM books').get().n, 'books'); }
