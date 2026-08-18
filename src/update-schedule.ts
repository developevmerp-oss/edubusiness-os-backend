import { db } from './config/db';

async function main() {
    const schedule = [
        { day: 'Monday', startTime: '09:00', endTime: '10:00' },
        { day: 'Tuesday', startTime: '09:00', endTime: '10:00' },
        { day: 'Wednesday', startTime: '09:00', endTime: '10:00' },
        { day: 'Thursday', startTime: '09:00', endTime: '10:00' },
        { day: 'Friday', startTime: '09:00', endTime: '10:00' },
        { day: 'Saturday', startTime: '09:00', endTime: '10:00' },
        { day: 'Sunday', startTime: '09:00', endTime: '10:00' }
    ];
    await db.query(
        "UPDATE batches SET schedule = $1::jsonb WHERE id = 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'",
        [JSON.stringify(schedule)]
    );
    console.log("SUCCESS: Batch A schedule expanded to include all weekdays.");
}

main().catch(console.error).finally(() => process.exit(0));
