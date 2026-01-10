import 'dotenv/config';
import { supabase } from './api/_supabase.js';

async function check() {
    const { data, error } = await supabase
        .from('projects')
        .select('project_code, project_name, drive_folder_link')
        .limit(15);

    if (error) {
        console.error('Error:', error.message);
    } else {
        console.log('Projects in Supabase:\n');
        data.forEach(p => {
            console.log(`  ${p.project_code}: ${p.project_name || 'N/A'}`);
            console.log(`    Drive Link: ${p.drive_folder_link || 'none'}`);
        });
        console.log(`\nTotal shown: ${data.length}`);
    }
}
check();
