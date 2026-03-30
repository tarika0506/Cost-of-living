const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');

async function scrapeCities() {
    try {
        const response = await fetch('https://www.numbeo.com/cost-of-living/country_result.jsp?country=India');
        if (!response.ok) {
            console.error('Local fetch blocked:', response.status);
            return;
        }
        const html = await response.text();
        const $ = cheerio.load(html);
        const cities = $('#city option')
            .map((i, el) => $(el).text())
            .toArray()
            .filter(c => c !== '--- Select city---' && c.trim() !== '');

        fs.writeFileSync('cities.json', JSON.stringify({ cities }, null, 2));
        console.log(`Successfully saved ${cities.length} cities to cities.json`);
    } catch (e) {
        console.error('Error:', e);
    }
}

scrapeCities();
