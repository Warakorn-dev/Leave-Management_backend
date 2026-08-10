import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const years = [2026, 2027];
  
  for (const year of years) {
    // Estimating lunar holidays for 2027
    const makhaBuchaDate = year === 2026 ? '03-03' : '02-20';
    const visakhaBuchaDate = year === 2026 ? '05-31' : '05-20';
    const asarnhaBuchaDate = year === 2026 ? '07-29' : '07-18';
    const khaoPhansaDate = year === 2026 ? '07-30' : '07-19';

    await prisma.publicHoliday.createMany({
      data: [
        { name: 'วันขึ้นปีใหม่', date: new Date(`${year}-01-01T00:00:00Z`) },
        { name: 'วันมาฆบูชา', date: new Date(`${year}-${makhaBuchaDate}T00:00:00Z`) },
        { name: 'วันจักรี', date: new Date(`${year}-04-06T00:00:00Z`) },
        { name: 'วันสงกรานต์', date: new Date(`${year}-04-13T00:00:00Z`) },
        { name: 'วันสงกรานต์', date: new Date(`${year}-04-14T00:00:00Z`) },
        { name: 'วันสงกรานต์', date: new Date(`${year}-04-15T00:00:00Z`) },
        { name: 'วันแรงงานแห่งชาติ', date: new Date(`${year}-05-01T00:00:00Z`) },
        { name: 'วันฉัตรมงคล', date: new Date(`${year}-05-04T00:00:00Z`) },
        { name: 'วันวิสาขบูชา', date: new Date(`${year}-${visakhaBuchaDate}T00:00:00Z`) },
        { name: 'วันเฉลิมฯ พระราชินี', date: new Date(`${year}-06-03T00:00:00Z`) },
        { name: 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว', date: new Date(`${year}-07-28T00:00:00Z`) },
        { name: 'วันอาสาฬหบูชา', date: new Date(`${year}-${asarnhaBuchaDate}T00:00:00Z`) },
        { name: 'วันเข้าพรรษา', date: new Date(`${year}-${khaoPhansaDate}T00:00:00Z`) },
        { name: 'วันแม่แห่งชาติ', date: new Date(`${year}-08-12T00:00:00Z`) },
        { name: 'วันคล้ายวันสวรรคต ร.9', date: new Date(`${year}-10-13T00:00:00Z`) },
        { name: 'วันปิยมหาราช', date: new Date(`${year}-10-23T00:00:00Z`) },
        { name: 'วันพ่อแห่งชาติ', date: new Date(`${year}-12-05T00:00:00Z`) },
        { name: 'วันรัฐธรรมนูญ', date: new Date(`${year}-12-10T00:00:00Z`) },
        { name: 'วันสิ้นปี', date: new Date(`${year}-12-31T00:00:00Z`) },
      ],
      skipDuplicates: true
    });
    console.log(`All ${year} Holidays inserted!`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
