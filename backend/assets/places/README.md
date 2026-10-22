# India's states, districts, localities and PIN codes

`india-pincodes.json.gz` feeds the address dropdowns (API `GET /v1/places/...`, `src/modules/places/`): state →
district → localities (post office areas) with their PIN codes, and a position for "use my location".

- **Source:** India Post, *All India Pincode Directory* (Department of Posts, data.gov.in), under the Government Open
  Data License – India (free to use, also commercially, with this attribution). The file in use is a mid-2024 copy;
  a handful of post offices opened since then are missing. Technicians can still type such a locality in: the PIN
  code is then checked against the district.
- **Limits:** India Post lists post offices, not every neighbourhood name (Ameerpet and Madhapur, for example, are
  served by other post offices), and some of its map positions are kilometres off. "Use my location" therefore trusts
  the phone's own PIN code first.
- **Refresh:** download the latest CSV from data.gov.in ("All India Pincode Directory"), then
  `node scripts/build-places.mjs <file.csv> <yyyy-mm>` and commit the new `.json.gz`. The server reads it at start.
