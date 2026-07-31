/*
HandDraw ESP — frozen nominal component dimensions
SPDX-License-Identifier: GPL-3.0-or-later

These are engineering nominal values. Replace the values marked MEASURE with
measurements from the purchased components before exporting production STL.
The reference sources and measurement procedure are documented in
hardware/MEASUREMENTS.md.
*/

// ---------- Fasteners and print compensation ----------
fit_clearance = 0.30;              // one-side sliding clearance for calibrated PETG
m2_clear = 2.40;
m3_clear = 3.35;
m4_clear = 4.45;
m5_clear = 5.45;
m3_insert_d = 4.70;                // MEASURE heat-set insert outside diameter
m3_insert_depth = 5.00;

// ---------- Base and work area ----------
base_x = 420;
base_y = 500;
base_z = 12;
work_travel_x = 225;
work_travel_y = 315;
paper_x = 210;
paper_y = 297;

// ---------- MGN12 rail and MGN12H block ----------
// HIWIN nominal: rail 12 x 8, fixing pitch 25; MGN12H 27 x 45.4 x 13,
// mounting grid 20 x 20, M3.
mgn12_rail_w = 12;
mgn12_rail_h = 8;
mgn12_rail_counterbore_d = 6;
mgn12_rail_hole_d = 3.5;
mgn12_rail_hole_pitch = 25;
mgn12h_block_w = 27;
mgn12h_block_l = 45.4;
mgn12h_assembly_h = 13;
mgn12h_hole_x = 20;
mgn12h_hole_y = 20;
mgn12h_thread = 3;

// Purchased rail lengths.
y_rail_length = 450;
x_rail_length = 300;

// Distance between the centres of the two Y blocks. 52 mm leaves a useful
// reserve on a 450 mm rail while still suppressing yaw of the beam.
y_block_spacing = 52;
y_end_clearance = 8;
x_end_clearance = 8;

// ---------- 2020 profile ----------
profile_size = 20;
profile_slot = 6;                  // confirm the purchased profile is slot 6
profile_length = 350;
profile_fit_clearance = 0.35;
profile_inertia_mm4 = 7200;        // 0.72 cm^4 reference value
aluminium_e_n_per_mm2 = 69000;

// ---------- NEMA17 reference motor ----------
// Target electrical class: 42 Ncm, 1.5 A/phase, 1.8 degree, 5 mm shaft.
// Freeze an exact SKU before setting TMC2209 Vref.
nema17_face = 42;
nema17_body_l = 38;
nema17_mount_pitch = 31;           // MEASURE / verify against the exact motor drawing
nema17_pilot_d = 22;               // MEASURE / verify against the exact motor drawing
nema17_shaft_d = 5;
nema17_shaft_l = 23.5;
nema17_mount_hole_d = m3_clear;
nema17_rated_current_a = 1.50;
nema17_holding_torque_ncm = 42;

// ---------- GT2 transmission ----------
gt2_pitch = 2;
gt2_belt_w = 6;
gt2_pulley_teeth = 20;
gt2_pulley_bore = 5;
gt2_pulley_od = 12.2;              // reference envelope, MEASURE purchased pulley
gt2_pulley_w = 16;                 // including flanges, MEASURE
gt2_idler_axle_d = 5;
gt2_idler_od = 18;                 // reference envelope, MEASURE
gt2_idler_w = 11;                  // reference envelope, MEASURE

// ---------- Pen lift servo ----------
// Original TowerPro MG90S nominal body and ear span. Clones vary materially.
mg90s_body_x = 22.8;
mg90s_body_y = 12.2;
mg90s_body_z = 28.5;
mg90s_ear_span = 32.5;
mg90s_ear_hole_d = 2.2;            // MEASURE supplied screws
mg90s_output_offset_x = 6.0;        // MEASURE from body centre to output shaft
mg90s_horn_radius = 10;
mg90s_torque_kgcm_48v = 1.8;

// ---------- Generic microswitch ----------
// Provisional geometry for SS-5GL-style COM/NO/NC switch. Freeze exact part.
switch_body_x = 19.8;
switch_body_y = 6.4;
switch_body_z = 10.3;
switch_hole_pitch = 9.5;
switch_hole_d = 2.35;

// ---------- 625 bearing support roller ----------
bearing625_id = 5;
bearing625_od = 16;
bearing625_w = 5;

// ---------- MKS DLC32 enclosure ----------
// Board outline is broadly 90 x 70 mm, but mounting holes and connectors vary
// between V2.1_001, V2.1_002 and V2.1_003. These hole positions are deliberately
// provisional and the enclosure must not be printed before measurement.
mks_board_x = 90;
mks_board_y = 70;
mks_board_z = 20;
mks_mount_dx = 80;                 // MEASURE exact subrevision
mks_mount_dy = 60;                 // MEASURE exact subrevision
mks_mount_hole_d = m3_clear;

// ---------- Selected printable interfaces ----------
y_plate_t = 8;
y_plate_x_min = -38;
y_plate_x_size = 130;
y_plate_y_size = 112;
y_saddle_centres_x = [25, 75];
beam_saddle_mount_dx = 14;
beam_saddle_mount_dy = 32;
beam_saddle_rise = 18;

x_plate_w = 80;
x_plate_h = 86;
x_plate_t = 8;
x_plate_block_center_z = 41;
pen_mount_x = 16;
pen_mount_z = 40;
servo_mount_z = 30;
belt_clamp_pitch = 18;

pen_d = 10.2;                      // MEASURE intended pen barrel
pen_slide_wall = 2.5;
pen_body_wall = 3.0;
pen_body_h = 66;
pen_slider_h = 58;
pen_vertical_travel = 5;
pen_spring_od = 10;                // MEASURE spring
pen_spring_wire = 0.8;             // MEASURE spring
pen_target_force_n = 2.0;

// ---------- Fixed drive-centre locations ----------
// These values include collision reserve for the controlled 225 x 315 mm field.
y_drive_motor_center_y = 10;
y_drive_idler_center_y = 480;
x_drive_motor_center_x = 30;
x_drive_idler_center_x = 390;
