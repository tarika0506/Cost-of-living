const express = require('express');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const _ = require('lodash');
const fs = require('fs');
const path = require('path');

// Load static fallback cities JSON that we generated locally
const backupCities = JSON.parse(fs.readFileSync(path.join(__dirname, 'cities.json'), 'utf8'));

const app = express();
const { PORT = 3000 } = process.env;

// Simple in-memory cache
const cache = {
  cities: { data: null, timestamp: 0 },
  cityDetails: {} // cityKey -> { data, timestamp }
};
const CACHE_DURATION = 3600000; // 1 hour in ms

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept',
  );
  next();
});

app.get('/cities', async (req, res) => {
  const now = Date.now();
  if (cache.cities.data && (now - cache.cities.timestamp < CACHE_DURATION)) {
    console.log('Serving cities from cache');
    return res.json({ cities: cache.cities.data });
  }

  try {
    const response = await fetch('https://www.numbeo.com/cost-of-living/country_result.jsp?country=India');
    if (!response.ok) {
      console.log('Numbeo fetch blocked, serving local backup list instead...');
      if (cache.cities.data) return res.json({ cities: cache.cities.data }); 
      return res.json(backupCities); // Return our massive JSON file instead!
    }
    const html = await response.text();
    const $ = cheerio.load(html);
    const cities = $('#city option')
      .map((i, el) => $(el).text())
      .toArray()
      .filter(c => c !== '--- Select city---' && c.trim() !== '');
    
    // Update cache
    cache.cities.data = cities;
    cache.cities.timestamp = now;

    return res.json({ cities });
  } catch (error) {
    if (cache.cities.data) return res.json({ cities: cache.cities.data });
    return res.json(backupCities);
  }
});

app.get('/:city', async (req, res) => {
  const cityKey = req.params.city.toLowerCase();
  const now = Date.now();
  const currency = Object.keys(req.query)[0] ? Object.keys(req.query)[0] : 'CAD';
  const cacheKey = `${cityKey}_${currency}`;

  if (cache.cityDetails[cacheKey] && (now - cache.cityDetails[cacheKey].timestamp < CACHE_DURATION)) {
    console.log(`Serving ${cityKey} from cache`);
    return res.json(cache.cityDetails[cacheKey].data);
  }

  const city = _.words(_.startCase(req.params.city)).join('-');

  try {
    const response = await fetch(
      `https://www.numbeo.com/cost-of-living/in/${city}?displayCurrency=${currency}`,
    );
    if (!response.ok) {
      if (cache.cityDetails[cacheKey]) return res.json(cache.cityDetails[cacheKey].data);
      return res.status(response.status).send(response.statusText);
    }
    const html = await response.text();
    const $ = cheerio.load(html);

    const rows = $('body > div.innerWidth > table > tbody > tr')
      .filter((i, el) => $(el).children('td').length === 3)
      .map((i, el) =>
        $(el)
          .children()
          .map((i, el) => $(el).text().trim())
          .toArray(),
      )
      .toArray();

    const costs = chunkArray(rows, 3).map(([item, costWithSymbol, range]) => {
      const cost = parseFloat(costWithSymbol.replace(/[^0-9.]/g, '')) || 0;
      const [rangeLow, rangeHigh] = range
        .split('-')
        .map((val) => parseFloat(val.replace(/[^0-9.]/g, '')) || 0);

      return {
        item,
        cost,
        range: {
          low: rangeLow,
          high: rangeHigh,
        },
      };
    });

    const result = { city: req.params.city, currency, costs };

    // Update cache
    cache.cityDetails[cacheKey] = {
      data: result,
      timestamp: now,
    };

    return res.json(result);
  } catch (error) {
    if (cache.cityDetails[cacheKey]) return res.json(cache.cityDetails[cacheKey].data);
    return res.status(500).json({ error: 'Failed to fetch city details' });
  }
});

app.use((req, res) =>
  res.status(400).json({
    error: 'No city supplied. Please navigate to `/:city` to obtain results.',
  }),
);

function chunkArray(arr, chunkSize) {
  let temp = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    temp.push(arr.slice(i, i + chunkSize));
  }
  return temp;
}

app.listen(PORT, () =>
  console.log(`Cost of Living API running on port ${PORT}`),
);
