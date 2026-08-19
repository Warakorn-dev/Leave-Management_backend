const http = require('http');

http.get('http://localhost:8000/api/hr/employees', (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.log('GET failed with status', res.statusCode);
      return;
    }
    const resp = JSON.parse(data);
    const employees = resp.data || resp;
    if (!employees || employees.length === 0) {
      console.log('No employees found');
      return;
    }
    const emp = employees[0];
    console.log('Testing with employee:', emp.id);

    const payload = JSON.stringify({
      employeeCode: emp.employeeCode,
      firstName: emp.firstName,
      lastName: emp.lastName,
      email: emp.email,
      phone: emp.phone,
      departmentId: emp.departmentId,
      positionId: emp.positionId,
      roleName: emp.role,
      hireDate: emp.hireDate,
      gender: emp.gender,
    });

    const req = http.request({
      hostname: 'localhost',
      port: 8000,
      path: '/api/hr/employees/' + emp.id,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (patchRes) => {
      let patchData = '';
      patchRes.on('data', chunk => { patchData += chunk; });
      patchRes.on('end', () => {
        console.log('PATCH response status:', patchRes.statusCode);
        console.log('PATCH response data:', patchData);
      });
    });

    req.on('error', (e) => {
      console.error('Problem with request:', e.message);
    });

    req.write(payload);
    req.end();
  });
}).on('error', (err) => {
  console.log('Error: ' + err.message);
});
