import { supabase } from "../lib/_supabase.js";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  try {
    if (!supabase) {
      return json(res, 500, { success: false, message: "Supabase client not initialized" });
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const type = url.searchParams.get('type');

    // If type=headers, return invoice table headers (merged from headers.js)
    if (type === 'headers') {
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .limit(1);

      if (error) {
        console.error("Supabase Error:", error.message);
        return json(res, 500, { success: false, message: error.message });
      }

      const headers = data && data.length > 0 ? Object.keys(data[0]) : [];
      return json(res, 200, { success: true, headers });
    }

    // Default: return companies and projects lists
    const [companiesRes, projectsRes] = await Promise.all([
      supabase.from('companies').select('company_name'),
      supabase.from('projects').select('project_name'),
    ]);

    if (companiesRes.error) {
      return json(res, 500, { success: false, message: companiesRes.error.message });
    }
    if (projectsRes.error) {
      return json(res, 500, { success: false, message: projectsRes.error.message });
    }

    const companies = (companiesRes.data || [])
      .map(r => (r.company_name || '').trim())
      .filter(Boolean);
    const projects = (projectsRes.data || [])
      .map(r => (r.project_name || '').trim())
      .filter(Boolean);

    return json(res, 200, {
      success: true,
      companies: Array.from(new Set(companies)).sort(),
      projects: Array.from(new Set(projects)).sort(),
    });
  } catch (e) {
    return json(res, 500, { success: false, message: e?.message || String(e) });
  }
}
