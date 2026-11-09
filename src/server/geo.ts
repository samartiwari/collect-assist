// Approximate pincode centroids for the demo area. Real geocoding is an outside system and
// is mocked here: a new loan gets its pincode's centre until a field visit records a better point.
const CENTROIDS: Record<string, { lat: number; lng: number; area: string }> = {
  '452001': { lat: 22.7196, lng: 75.8577, area: 'Rajwada' },
  '452002': { lat: 22.7286, lng: 75.8391, area: 'Malharganj' },
  '452003': { lat: 22.7392, lng: 75.8722, area: 'Palasia' },
  '452005': { lat: 22.7012, lng: 75.8861, area: 'Navlakha' },
  '452006': { lat: 22.6975, lng: 75.8692, area: 'Bhanwarkuan' },
  '452007': { lat: 22.7124, lng: 75.8342, area: 'Chandan Nagar' },
  '452009': { lat: 22.6883, lng: 75.8585, area: 'Rajendra Nagar' },
  '452010': { lat: 22.7533, lng: 75.8937, area: 'Vijay Nagar' },
  '452011': { lat: 22.7618, lng: 75.9127, area: 'Nipania' },
  '452012': { lat: 22.6932, lng: 75.8387, area: 'Sanwer Road Ind. Area' },
  '452015': { lat: 22.7745, lng: 75.8221, area: 'Sanwer Road Sector F' },
  '452016': { lat: 22.7449, lng: 75.9012, area: 'Scheme 78' },
  '452018': { lat: 22.6602, lng: 75.8291, area: 'Rau' },
  '454774': { lat: 22.6213, lng: 75.6812, area: 'Pithampur Sector 1' },
  '454775': { lat: 22.6070, lng: 75.6963, area: 'Pithampur Sector 3' },
  '455001': { lat: 22.9676, lng: 76.0534, area: 'Dewas City' },
  '455111': { lat: 22.9902, lng: 76.0708, area: 'Dewas Industrial Area' },
};

export function pincodeCentroid(pincode: string) {
  return CENTROIDS[pincode] ?? null;
}

export const KNOWN_PINCODES = Object.keys(CENTROIDS);
