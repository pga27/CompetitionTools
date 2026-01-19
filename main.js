import { PDFDocument, rgb } from 'https://cdn.skypack.dev/pdf-lib';

// --- SHARED UTILS ---
window.jsPDF = window.jspdf ? window.jspdf.jsPDF : null;

// --- PROJECT 1: BADGE INFO LOGIC ---
async function fetchCompetitionData() {
    const competitionID = document.getElementById("competitionID").value.trim();
    const errorEl = document.getElementById("badge-error");
    errorEl.classList.add('hidden');

    if (!competitionID) {
        errorEl.textContent = "Please enter a competition ID.";
        errorEl.classList.remove('hidden');
        return null;
    }

    try {
        const response = await fetch(`https://www.worldcubeassociation.org/api/v0/competitions/${competitionID}/wcif/public`);
        if (!response.ok) throw new Error("Failed to fetch data. Check the ID.");
        return await response.json();
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
        return null;
    }
}

function getPersonsInfo(data) {
    const roleNames = {
        'delegate': 'DELEGATE', 'organizer': 'ORGANIZER', 'trainee-delegate': 'TRAINEE-DELEGATE',
        'staff-dataentry': 'STAFF', 'staff-other': 'STAFF', 'staff-judge': 'STAFF',
        'staff-scrambler': 'STAFF', 'staff-runner': 'STAFF'
    };

    const personInfo = data.persons
        .filter(person => person.registration !== null)
        .map(person => {
            let role = person.roles.length === 0 ? 'COMPETITOR' : person.roles.map(r => roleNames[r] || 'STAFF').join('/');
            if (role.includes('STAFF')) role = 'STAFF';
            return {
                name: person.name, wcaId: person.wcaId, registrantId: person.registrantId,
                assignments: person.assignments || [], region: person.countryIso2, role: role
            };
        });

    const allActivities = {};
    data.schedule.venues.forEach(venue => {
        venue.rooms.forEach(room => {
            room.activities.forEach(act => {
                const activityMap = (a) => {
                    allActivities[a.id] = { name: a.name, activityCode: a.activityCode, room: room.name };
                    if (a.childActivities) a.childActivities.forEach(activityMap);
                };
                activityMap(act);
            });
        });
    });

    personInfo.forEach(p => {
        p.assignments.forEach(a => {
            a.activityCode = allActivities[a.activityId]?.activityCode || '';
            a.room = allActivities[a.activityId]?.room || '';
        });
    });

    return { personInfo, events: data.events.map(e => e.id) };
}

window.handleBadgeDownload = async function (type) {
    const data = await fetchCompetitionData();
    if (!data) return;

    const { personInfo, events } = getPersonsInfo(data);
    const multipleRooms = document.getElementById("multiple_rooms")?.checked;
    const separator = type === 'csv' ? ',' : '\t';

    let output = `name${separator}wcaID${separator}region${separator}registrantId${separator}role`;
    events.forEach(e => output += `${separator}${e}-tasks${separator}${e}-comp`);

    personInfo.forEach(p => {
        const region = countryCodes[p.region] || p.region;
        output += `\n${p.name}${separator}${p.wcaId || 'NEWCOMER'}${separator}${region}${separator}${p.registrantId}${separator}${p.role}`;

        events.forEach(event => {
            let comp = '', tasks = [];
            p.assignments.forEach(a => {
                const [ev, rnd, grp] = a.activityCode?.split('-') || [];
                if (ev === event && rnd === 'r1') {
                    const detail = grp?.slice(1) || '';
                    if (a.assignmentCode === 'competitor') comp = multipleRooms ? detail + a.room[0] : detail;
                    else {
                        let t = (a.assignmentCode.split('-')[1]?.[0] || 'S').toUpperCase() + detail;
                        tasks.push(multipleRooms ? t + '-' + a.room[0] : t);
                    }
                }
            });
            let taskStr = tasks.join(',');
            if (taskStr.includes(',')) taskStr = `"${taskStr}"`;
            output += `${separator}${taskStr}${separator}${comp}`;
        });
    });

    if (document.getElementById("addPlaceholder")?.checked) {
        output += `\nEXTRANAME,,,,VOLUNTEER` + events.map(() => `${separator}${separator}`).join('');
    }

    if (type === 'xlsx') {
        const ws = XLSX.utils.aoa_to_sheet(output.split('\n').map(r => r.split(separator)));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Badges");
        XLSX.writeFile(wb, `badges_info.xlsx`);
    } else {
        const blob = new Blob([output], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `badges_info.${type}`; a.click();
    }
};

// --- PROJECT 2: PDF FORMATTER ---
const processPdfBtn = document.getElementById('process-pdf-btn');
processPdfBtn.addEventListener('click', async () => {
    const fileInput = document.getElementById('pdf-file-input');
    const status = document.getElementById('pdf-status');
    if (!fileInput.files.length) return alert('Upload a PDF');

    status.classList.remove('hidden');
    const arrayBuffer = await fileInput.files[0].arrayBuffer();
    const inputPdf = await PDFDocument.load(arrayBuffer);
    const outputPdf = await PDFDocument.create();

    const badgeCount = inputPdf.getPageCount() / 2;
    const a4W = 595.28, a4H = 841.89;
    const bW = a4W / 2, bH = a4H / 2;

    for (let i = 0; i < badgeCount; i += 4) {
        const frontPage = outputPdf.addPage([a4W, a4H]);
        const backPage = outputPdf.addPage([a4W, a4H]);
        const pos = [[0, a4H - bH], [bW, a4H - bH], [0, 0], [bW, 0]];
        const backIdx = [1, 0, 3, 2];

        for (let j = 0; j < 4 && (i + j) < badgeCount; j++) {
            const f = await outputPdf.embedPage(inputPdf.getPage((i + j) * 2));
            const b = await outputPdf.embedPage(inputPdf.getPage((i + j) * 2 + 1));
            frontPage.drawPage(f, { x: pos[j][0], y: pos[j][1], width: bW, height: bH });
            backPage.drawPage(b, { x: pos[backIdx[j]][0], y: pos[backIdx[j]][1], width: bW, height: bH });
        }
        // --- CUTTING LINES ---
        const centerX = a4W / 2;
        const centerY = a4H / 2;
        const lineColor = rgb(0.5, 0.5, 0.5); // Gray lines

        // Draw Vertical Cutting Lines on both pages
        for (let lineY = 0; lineY < a4H; lineY += 6) {
            const rectCfg = { x: centerX - 0.25, y: lineY, width: 0.5, height: 3, color: lineColor };
            frontPage.drawRectangle(rectCfg);
            backPage.drawRectangle(rectCfg);
        }

        // Draw Horizontal Cutting Lines on both pages
        for (let lineX = 0; lineX < a4W; lineX += 6) {
            const rectCfg = { x: lineX, y: centerY - 0.25, width: 3, height: 0.5, color: lineColor };
            frontPage.drawRectangle(rectCfg);
            backPage.drawRectangle(rectCfg);
        }
    }


    const pdfBytes = await outputPdf.save({
        useObjectStreams: true,   // Groups objects into streams for better compression
        addDefaultPage: false,    // Prevents adding extra blank pages
        updateFieldAppearances: false // Skips generating appearances for form fields (saves space)
    });
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = 'reformatted.pdf'; link.click();
    status.textContent = "Done!";
});

// --- PROJECT 3: CHECK-IN GENERATOR ---
let checkinData = [], associateList = [], base64CustomLogo = '', base64WCA = '';

// Load WCA Logo
const loadLogo = async () => {
    try {
        const resp = await fetch('./logo_wca.png');
        const blob = await resp.blob();
        const reader = new FileReader();
        reader.onloadend = () => { base64WCA = reader.result; };
        reader.readAsDataURL(blob);
    } catch (e) { console.error("WCA Logo not found at ./logo_wca.png"); }
};
loadLogo();

const dropzone = document.getElementById('dropzone');
const checkinInput = document.getElementById('checkinFileInput');
const associateDropzone = document.getElementById('associate-dropzone');
const associateFileInput = document.getElementById('associateFile');
const generateCheckinBtn = document.getElementById('generate-checkin-btn');
const associateMode = document.getElementById('associate-mode');

// Main CSV Upload
dropzone.onclick = () => checkinInput.click();
checkinInput.onchange = e => handleFile(e.target.files[0], 'main');

// Associate CSV Upload
associateDropzone.onclick = () => associateFileInput.click();
associateFileInput.onchange = e => handleFile(e.target.files[0], 'associate');

function handleFile(file, type) {
    if (!file) return;
    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: res => {
            if (type === 'main') {
                checkinData = res.data.filter(r => r.Status === 'a');
                if (checkinData.length) {
                    dropzone.classList.add('success');
                    dropzone.textContent = `Loaded: ${file.name}`;
                    generateCheckinBtn.disabled = false;
                }
            } else {
                associateList = res.data.filter(p => p.fullName && p.wcaID);
                if (associateList.length) {
                    document.getElementById('associate-dropzone').classList.add('success');
                    document.getElementById('associate-dropzone-status').textContent = `Loaded: ${file.name}`;
                }
            }
        }
    });
}

// Toggle Visibility of Extra Section
associateMode.onchange = (e) => {
    const show = e.target.value !== "none";
    document.getElementById('extra-section').classList.toggle('hidden', !show);
};

// Custom Logo Upload
document.getElementById('customLogo').onchange = e => {
    const reader = new FileReader();
    reader.onload = ev => { base64CustomLogo = ev.target.result; };
    reader.readAsDataURL(e.target.files[0]);
};

const genderMap = {
    'm': 'Male',
    'f': 'Female',
    'o': 'Other'
};

generateCheckinBtn.onclick = () => {
    const { jsPDF } = window.jspdf;


    const drawTable = (doc, title, headers, rows) => {
        const pW = doc.internal.pageSize.getWidth();
        if (base64WCA) doc.addImage(base64WCA, 'PNG', 10, 10, 20, 20, undefined, 'MEDIUM');
        if (base64CustomLogo) doc.addImage(base64CustomLogo, 'PNG', pW - 30, 10, 20, 20, undefined, 'MEDIUM');

        doc.setFontSize(18);
        doc.setFont(undefined, 'bold');
        doc.text(title, pW / 2, 22, { align: 'center' });

        doc.autoTable({
            startY: 30,
            head: [['', ...headers]],
            body: rows.map(r => ['', ...r]),
            didDrawCell: data => {
                if (data.column.index === 0 && data.section === 'body') {
                    const boxSize = 5;
                    const x = data.cell.x + (data.cell.width - boxSize) / 2;
                    const y = data.cell.y + (data.cell.height - boxSize) / 2;

                    doc.setDrawColor(40, 40, 40);
                    doc.setLineWidth(0.2);
                    doc.rect(x, y, boxSize, boxSize);
                }
            },
            headStyles: {
                fillColor: [74, 144, 226],
                halign: 'left'
            },
            styles: {
                valign: 'middle'
            },
            columnStyles: {
                0: { cellWidth: 10 }
            }
        });
    };

    const autoDownload = (doc, filename) => {
        const blob = doc.output("blob");
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
    };



    // 1. Newcomers
    const newcomers = checkinData.filter(r => !r["WCA ID"] || r["WCA ID"] === 'null').sort((a, b) => a.Name.localeCompare(b.Name));
    if (newcomers.length) {
        const pdfN = new jsPDF({
            orientation: 'p',
            unit: 'mm',
            format: 'a4',
            putOnlyUsedFonts: true, // Only include characters used in the PDF
            compress: true          // Main compression toggle
        });

        // Map the rows to include full gender names and birth dates
        const newcomerRows = newcomers.map(p => [
            p["Registrant Id"],
            p.Name,
            p.Country,
            p["Birth Date"],
            genderMap[p.Gender?.toLowerCase()] || p.Gender || 'Other'
        ]);

        drawTable(
            pdfN,
            "Newcomer Check-In",
            ["ID", "Name", "Country", "Birth Date", "Gender"],
            newcomerRows
        );
        pdfN.save('NewcomerCheckIn.pdf');
    }

    // 2. Competitors (Exclude those in associate list if mode is ignore)
    const assocIDs = new Set(associateList.map(a => a.wcaID.trim()));
    const known = checkinData.filter(r => r["WCA ID"] && r["WCA ID"] !== 'null' && (associateMode.value !== 'ignore' || !assocIDs.has(r["WCA ID"])))
        .sort((a, b) => a.Name.localeCompare(b.Name));

    const pdfK = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4',
        putOnlyUsedFonts: true, // Only include characters used in the PDF
        compress: true          // Main compression toggle
    });
    drawTable(pdfK, "Competitor Check-In", ["ID", "Name", "WCA ID"], known.map(p => [p["Registrant Id"], p.Name, p["WCA ID"]]));
    pdfK.save('CompetitorCheckIn.pdf');

    // 3. Associates / Staff
    if (associateList.length && associateMode.value !== "none") {
        const pdfA = new jsPDF({
            orientation: 'p',
            unit: 'mm',
            format: 'a4',
            putOnlyUsedFonts: true, // Only include characters used in the PDF
            compress: true          // Main compression toggle
        });
        const title = document.getElementById('associateTitle').value || "Extra Check-In List";
        const compMap = new Map(checkinData.map(p => [p["WCA ID"], p]));

        const matched = associateList.map(person => {
            const wcaID = person.wcaID?.trim();
            const fromComp = compMap.get(wcaID);
            if (associateMode.value === "include" || fromComp) {
                return [fromComp?.["Registrant Id"] || '', fromComp?.["Name"] || person.fullName, wcaID];
            }
            return null;
        }).filter(Boolean).sort((a, b) => a[1].localeCompare(b[1]));

        if (matched.length) {
            drawTable(pdfA, title, ["ID", "Name", "WCA ID"], matched);
            pdfA.save(`${title}.pdf`);
        }
    }
};