/*
HandDraw ESP — coherent parametric A4 plotter assembly
SPDX-License-Identifier: GPL-3.0-or-later

This file replaces the former catalogue-style preview with one coordinate
system, mating interfaces, travel calculations and a real machine assembly.
Before production export, edit component_dimensions.scad from physical
measurements and complete hardware/MEASUREMENTS.md.
*/

include <component_dimensions.scad>

$fn = 56;

// assembly | motion_envelope | exploded | y_carriage_plate | beam_saddle
// x_carriage_plate | pen_body | pen_slider | pen_cap | servo_bracket
// y_motor_mount | y_idler_mount | x_motor_mount | x_idler_mount
// belt_clamp | support_roller | endstop | electronics_base
// electronics_lid | cable_clip | fit_coupon
part = "assembly";
assembly_state = "center";         // home | center | max
show_reference_components = true;
show_work_envelope = true;
show_dimensions = true;

// ---------- Machine layout ----------
y_rail_x = 45;
y_rail_y0 = 25;
beam_x0 = 35;
x_rail_start = 25;
pen_forward_offset = 45;

// Derived Z stack: base -> MGN12H top -> Y plate -> saddle -> 2020 profile.
y_plate_bottom_z = base_z + mgn12h_assembly_h;
profile_bottom_z = y_plate_bottom_z + y_plate_t + beam_saddle_rise;
profile_center_z = profile_bottom_z + profile_size / 2;
x_plate_bottom_z = profile_center_z - x_plate_block_center_z;
pen_body_bottom_z = x_plate_bottom_z + 6;
x_belt_z = profile_center_z + 14;

// Travel is based on component envelopes, not on the nominal rail length alone.
y_group_length = mgn12h_block_l + y_block_spacing;
y_physical_travel = y_rail_length - y_group_length - 2 * y_end_clearance;
x_physical_travel = x_rail_length - mgn12h_block_l - 2 * x_end_clearance;
y_control_margin = (y_physical_travel - work_travel_y) / 2;
x_control_margin = (x_physical_travel - work_travel_x) / 2;

y_group_center_physical_min = y_rail_y0 + y_end_clearance + y_group_length / 2;
y_group_center_physical_max = y_group_center_physical_min + y_physical_travel;
y_group_center_min = y_group_center_physical_min + y_control_margin;
y_group_center_max = y_group_center_min + work_travel_y;

x_block_center_physical_min = x_rail_start + x_end_clearance + mgn12h_block_l / 2;
x_block_center_physical_max = x_block_center_physical_min + x_physical_travel;
x_block_center_min = x_block_center_physical_min + x_control_margin;
x_block_center_max = x_block_center_min + work_travel_x;

work_origin_x = beam_x0 + x_block_center_min;
work_origin_y = y_group_center_min + pen_forward_offset;
paper_origin_x = work_origin_x + (work_travel_x - paper_x) / 2;
paper_origin_y = work_origin_y + (work_travel_y - paper_y) / 2;

support_bearing_center_drop = profile_bottom_z - (base_z + bearing625_od / 2);

assert(y_physical_travel >= work_travel_y,
    str("Y travel insufficient: ", y_physical_travel, " < ", work_travel_y, " mm"));
assert(x_physical_travel >= work_travel_x,
    str("X travel insufficient: ", x_physical_travel, " < ", work_travel_x, " mm"));
assert(work_origin_x >= 0 && work_origin_x + work_travel_x <= base_x,
    "X work envelope does not fit the base");
assert(work_origin_y >= 0 && work_origin_y + work_travel_y <= base_y,
    "Y work envelope does not fit the base");
assert(paper_x <= work_travel_x && paper_y <= work_travel_y,
    "Portrait A4 does not fit the configured work envelope");
assert(profile_length >= x_rail_start + x_rail_length,
    "X rail extends beyond the 2020 profile");
assert(y_block_spacing > 0 && y_block_spacing + mgn12h_block_l < y_rail_length,
    "Invalid Y block spacing");

function clamp_value(v, lo, hi) = min(max(v, lo), hi);
function state_fraction(state) = state == "home" ? 0 : state == "max" ? 1 : 0.5;
function lerp(a, b, t) = a + (b - a) * t;

// ---------- Generic geometry helpers ----------
module rounded_box(size = [20, 20, 10], r = 2, center = false) {
    sx = size[0]; sy = size[1]; sz = size[2];
    ox = center ? -sx / 2 : 0;
    oy = center ? -sy / 2 : 0;
    oz = center ? -sz / 2 : 0;
    translate([ox, oy, oz])
        hull()
            for (x = [r, sx - r], y = [r, sy - r])
                translate([x, y, 0]) cylinder(r = r, h = sz);
}

module rounded_plate_xz(w, h, t, r = 4) {
    hull()
        for (x = [-w / 2 + r, w / 2 - r], z = [r, h - r])
            translate([x, 0, z]) rotate([90, 0, 0]) cylinder(r = r, h = t, center = true);
}

module hole_z(d, h = 20) {
    translate([0, 0, -1]) cylinder(d = d, h = h + 2);
}

module hole_y(d, h = 20) {
    rotate([90, 0, 0]) cylinder(d = d, h = h, center = true);
}

module hole_x(d, h = 20) {
    rotate([0, 90, 0]) cylinder(d = d, h = h, center = true);
}

module mgn_pattern_z(spacing = [20, 20], d = m3_clear, h = 20) {
    for (x = [-spacing[0] / 2, spacing[0] / 2], y = [-spacing[1] / 2, spacing[1] / 2])
        translate([x, y, 0]) hole_z(d, h);
}

module mgn_pattern_y(spacing = [20, 20], d = m3_clear, h = 20) {
    for (x = [-spacing[0] / 2, spacing[0] / 2], z = [-spacing[1] / 2, spacing[1] / 2])
        translate([x, 0, z]) hole_y(d, h);
}

module slot_z(d, length, h = 20) {
    hull() {
        translate([0, -length / 2, 0]) hole_z(d, h);
        translate([0,  length / 2, 0]) hole_z(d, h);
    }
}

module slot_y(d, length, h = 20) {
    hull() {
        translate([0, 0, -length / 2]) hole_y(d, h);
        translate([0, 0,  length / 2]) hole_y(d, h);
    }
}

// ---------- Reference components: not printable ----------
module mgn12_rail_y_reference(length) {
    color([0.26, 0.31, 0.35])
    difference() {
        cube([mgn12_rail_w, length, mgn12_rail_h]);
        for (y = [12.5 : mgn12_rail_hole_pitch : length - 5])
            translate([mgn12_rail_w / 2, y, -1]) cylinder(d = mgn12_rail_hole_d, h = mgn12_rail_h + 2);
    }
}

module mgn12_rail_x_reference(length) {
    color([0.26, 0.31, 0.35])
    difference() {
        cube([length, mgn12_rail_h, mgn12_rail_w]);
        for (x = [12.5 : mgn12_rail_hole_pitch : length - 5])
            translate([x, -1, mgn12_rail_w / 2]) rotate([-90, 0, 0])
                cylinder(d = mgn12_rail_hole_d, h = mgn12_rail_h + 2);
    }
}

module mgn12h_block_y_reference() {
    block_top_h = mgn12h_assembly_h - mgn12_rail_h;
    color([0.62, 0.68, 0.72])
    difference() {
        translate([-mgn12h_block_w / 2, -mgn12h_block_l / 2, 0])
            rounded_box([mgn12h_block_w, mgn12h_block_l, block_top_h], 2);
        for (x = [-mgn12h_hole_x / 2, mgn12h_hole_x / 2],
             y = [-mgn12h_hole_y / 2, mgn12h_hole_y / 2])
            translate([x, y, -1]) cylinder(d = 2.6, h = block_top_h + 2);
    }
}

module mgn12h_block_x_reference() {
    block_top_h = mgn12h_assembly_h - mgn12_rail_h;
    color([0.62, 0.68, 0.72])
    difference() {
        translate([-mgn12h_block_l / 2, 0, -mgn12h_block_w / 2])
            rounded_box([mgn12h_block_l, block_top_h, mgn12h_block_w], 2);
        for (x = [-mgn12h_hole_y / 2, mgn12h_hole_y / 2],
             z = [-mgn12h_hole_x / 2, mgn12h_hole_x / 2])
            translate([x, block_top_h / 2, z]) hole_y(2.6, block_top_h + 2);
    }
}

module profile_2020_reference(length) {
    color([0.18, 0.22, 0.25])
    difference() {
        cube([length, profile_size, profile_size]);
        // Visual slot representation; manufacturing geometry is defined by the purchased profile.
        for (side = [0, 1])
            translate([length / 2, side ? profile_size + 0.01 : -0.01, profile_size / 2])
                rotate([90, 0, 0]) cube([length - 4, profile_slot, 1.2], center = true);
        translate([length / 2, profile_size / 2, profile_size + 0.01])
            cube([length - 4, profile_slot, 1.2], center = true);
    }
}

module nema17_reference() {
    // Shaft points toward +Y; rotate the module for other axes.
    color([0.19, 0.22, 0.24])
        translate([-nema17_face / 2, -nema17_body_l, -nema17_face / 2])
            rounded_box([nema17_face, nema17_body_l, nema17_face], 3);
    color([0.65, 0.68, 0.70])
        rotate([90, 0, 0]) cylinder(d = nema17_pilot_d, h = 2.2, center = true);
    color([0.72, 0.74, 0.76])
        translate([0, nema17_shaft_l / 2, 0]) rotate([90, 0, 0])
            cylinder(d = nema17_shaft_d, h = nema17_shaft_l, center = true);
}

module pulley_reference(axis = "y") {
    color([0.48, 0.50, 0.52])
        if (axis == "x") rotate([0, 90, 0]) cylinder(d = gt2_pulley_od, h = gt2_pulley_w, center = true);
        else rotate([90, 0, 0]) cylinder(d = gt2_pulley_od, h = gt2_pulley_w, center = true);
}

module idler_reference(axis = "y") {
    color([0.56, 0.58, 0.60])
        if (axis == "x") rotate([0, 90, 0]) cylinder(d = gt2_idler_od, h = gt2_idler_w, center = true);
        else rotate([90, 0, 0]) cylinder(d = gt2_idler_od, h = gt2_idler_w, center = true);
}

module bearing625_reference(axis = "x") {
    color([0.58, 0.61, 0.63])
    difference() {
        if (axis == "x") rotate([0, 90, 0]) cylinder(d = bearing625_od, h = bearing625_w, center = true);
        else rotate([90, 0, 0]) cylinder(d = bearing625_od, h = bearing625_w, center = true);
        if (axis == "x") rotate([0, 90, 0]) cylinder(d = bearing625_id, h = bearing625_w + 2, center = true);
        else rotate([90, 0, 0]) cylinder(d = bearing625_id, h = bearing625_w + 2, center = true);
    }
}

module mg90s_reference() {
    color([0.12, 0.32, 0.72])
        translate([-mg90s_body_x / 2, 0, 0]) cube([mg90s_body_x, mg90s_body_y, mg90s_body_z]);
    color([0.10, 0.25, 0.58])
        translate([-mg90s_ear_span / 2, -2, 4]) cube([mg90s_ear_span, mg90s_body_y + 4, 3]);
    color([0.82, 0.82, 0.78])
        translate([mg90s_output_offset_x, mg90s_body_y / 2, mg90s_body_z + 1.5])
            cylinder(d = 5, h = 3, center = true);
}

module switch_reference() {
    color([0.14, 0.14, 0.14])
        translate([-switch_body_x / 2, -switch_body_y / 2, 0]) cube([switch_body_x, switch_body_y, switch_body_z]);
    color([0.65, 0.65, 0.65])
        translate([-switch_body_x / 2 + 2, 0, switch_body_z]) rotate([0, 25, 0])
            cube([switch_body_x + 7, 0.8, 1.5]);
}

module pen_reference(tip_z, centre_x, centre_y) {
    color([0.16, 0.16, 0.18])
        translate([centre_x, centre_y, tip_z + 45]) cylinder(d = pen_d, h = 90, center = true);
    color([0.05, 0.05, 0.05])
        translate([centre_x, centre_y, tip_z + 1]) cylinder(d1 = 1.2, d2 = pen_d * 0.55, h = 8, center = true);
}

// ---------- Printable parts ----------
module y_carriage_plate() {
    difference() {
        translate([y_plate_x_min, -y_plate_y_size / 2, 0])
            rounded_box([y_plate_x_size, y_plate_y_size, y_plate_t], 5);

        // Two MGN12H blocks, one rail, 52 mm centre spacing.
        for (cy = [-y_block_spacing / 2, y_block_spacing / 2])
            translate([0, cy, 0]) mgn_pattern_z([mgn12h_hole_x, mgn12h_hole_y], m3_clear, y_plate_t);

        // Two independent beam saddles. Interface: 14 x 32 mm, four M4 fasteners.
        for (sx = y_saddle_centres_x,
             dx = [-beam_saddle_mount_dx / 2, beam_saddle_mount_dx / 2],
             dy = [-beam_saddle_mount_dy / 2, beam_saddle_mount_dy / 2])
            translate([sx + dx, dy, 0]) hole_z(m4_clear, y_plate_t);

        // Y belt clamp, 18 mm pitch, exactly matching belt_clamp().
        for (dy = [-belt_clamp_pitch / 2, belt_clamp_pitch / 2])
            translate([-20, dy, 0]) hole_z(m3_clear, y_plate_t);

        // Weight-relief windows kept clear of every mounting interface.
        for (sx = [38, 67])
            translate([sx, 0, -1]) rounded_box([18, 34, y_plate_t + 2], 5, center = true);

        // Cable tie slots at the right edge.
        for (dy = [-27, 27])
            translate([83, dy, -1]) rounded_box([7, 15, y_plate_t + 2], 2, center = true);
    }
}

// Backward-compatible alias used in older documentation.
module y_dual_carriage_plate() y_carriage_plate();

module beam_saddle() {
    base = [22, 46, 5];
    channel = profile_size + 2 * profile_fit_clearance;
    wall = 4;
    difference() {
        union() {
            translate([-base[0] / 2, -base[1] / 2, 0]) rounded_box(base, 3);
            translate([-base[0] / 2, -channel / 2, base[2]])
                cube([base[0], channel, beam_saddle_rise - base[2]]);
            // Two side jaws embrace the 2020 profile without relying on print tolerance alone.
            for (side = [-1, 1])
                translate([-base[0] / 2,
                    side > 0 ? channel / 2 : -channel / 2 - wall,
                    beam_saddle_rise - 2])
                    cube([base[0], wall, profile_size + 2]);
        }
        // Four M4 holes match y_carriage_plate().
        for (dx = [-beam_saddle_mount_dx / 2, beam_saddle_mount_dx / 2],
             dy = [-beam_saddle_mount_dy / 2, beam_saddle_mount_dy / 2])
            translate([dx, dy, 0]) hole_z(m4_clear, beam_saddle_rise + profile_size + 3);
        // M5 cross-bolts clamp T-nuts in both side grooves.
        for (z = [beam_saddle_rise + 6, beam_saddle_rise + 14])
            translate([0, 0, z]) hole_y(m5_clear, channel + 2 * wall + 4);
    }
}

module x_carriage_plate() {
    difference() {
        rounded_plate_xz(x_plate_w, x_plate_h, x_plate_t, 5);

        // MGN12H interface on the rear face.
        translate([0, 0, x_plate_block_center_z])
            mgn_pattern_y([mgn12h_hole_y, mgn12h_hole_x], m3_clear, x_plate_t + 4);

        // Pen body interface: four M4 holes, 32 x 40 mm.
        for (x = [-pen_mount_x, pen_mount_x], z = [12, 12 + pen_mount_z])
            translate([x, 0, z]) hole_y(m4_clear, x_plate_t + 4);

        // Servo bracket: two M3 holes on a vertical 30 mm pitch.
        for (z = [18, 18 + servo_mount_z])
            translate([-31, 0, z]) hole_y(m3_clear, x_plate_t + 4);

        // X belt clamp: two M3 holes, same 18 mm pitch as belt_clamp().
        for (x = [-belt_clamp_pitch / 2, belt_clamp_pitch / 2])
            translate([x, 0, x_belt_z - x_plate_bottom_z]) hole_y(m3_clear, x_plate_t + 4);

        // Cable and weight-relief opening above the MGN interface.
        translate([25, 0, 68]) rotate([90, 0, 0])
            rounded_box([17, 18, x_plate_t + 2], 4, center = true);
    }
}

module x_carriage() x_carriage_plate();

module pen_body() {
    guide_od = pen_d + 2 * pen_slide_wall + 2 * pen_body_wall;
    guide_id = pen_d + 2 * pen_slide_wall + 2 * fit_clearance;
    guide_y = 16;
    backplate = [44, 6, pen_body_h];

    difference() {
        union() {
            translate([-backplate[0] / 2, 0, 0]) rounded_box(backplate, 4);
            translate([0, guide_y, 0]) cylinder(d = guide_od, h = pen_body_h);
            // Webs transfer spring force to the mounting plate.
            for (side = [-1, 1])
                hull() {
                    translate([side * 16, backplate[1], 8]) cube([3, 3, 40], center = true);
                    translate([side * guide_od * 0.28, guide_y, 15]) cylinder(d = 5, h = 35);
                }
        }
        translate([0, guide_y, -1]) cylinder(d = guide_id, h = pen_body_h + 2);
        // Four-hole interface matches x_carriage_plate().
        for (x = [-pen_mount_x, pen_mount_x], z = [12, 12 + pen_mount_z])
            translate([x, backplate[1] / 2, z]) hole_y(m4_clear, backplate[1] + 4);
        // Longitudinal anti-rotation slot matching the slider key.
        translate([-2.1, guide_y - guide_od / 2 - 1, 5]) cube([4.2, 6, pen_body_h - 10]);
        // Lift-wire passage.
        translate([0, guide_y + guide_od / 2, pen_body_h - 12]) hole_y(2.4, 16);
    }
}

module pen_slider() {
    slider_od = pen_d + 2 * pen_slide_wall;
    difference() {
        union() {
            cylinder(d = slider_od, h = pen_slider_h);
            translate([-1.7, -slider_od / 2 - 1, 7]) cube([3.4, 3.8, pen_slider_h - 14]);
            translate([-5, slider_od / 2 - 1, pen_slider_h - 14]) rounded_box([10, 9, 12], 2);
        }
        translate([0, 0, -1]) cylinder(d = pen_d + 2 * fit_clearance, h = pen_slider_h + 2);
        // Split collet and transverse clamp.
        translate([-0.7, -slider_od / 2 - 2, 0]) cube([1.4, slider_od / 2 + 3, pen_slider_h + 2]);
        translate([0, -slider_od / 4, 15]) hole_x(m3_clear, slider_od + 8);
        translate([slider_od / 2 - 1, -slider_od / 4, 15])
            rotate([0, 90, 0]) cylinder(d = m3_insert_d, h = m3_insert_depth, center = true);
        translate([0, slider_od / 2 + 2, pen_slider_h - 8]) hole_y(1.8, 14);
    }
}

module pen_cap() {
    guide_od = pen_d + 2 * pen_slide_wall + 2 * pen_body_wall;
    difference() {
        cylinder(d = guide_od + 2.4, h = 13);
        translate([0, 0, -1]) cylinder(d = guide_od + 0.35, h = 8);
        translate([0, 0, 5]) cylinder(d = pen_spring_od + 1.0, h = 10);
        translate([0, (guide_od + 2.4) / 2, 6]) hole_y(m3_clear, 12);
    }
}

module servo_bracket() {
    mount_strip_w = 10;
    cradle_x = mg90s_body_x + 2 * fit_clearance + 6;
    cradle_y = mg90s_body_y + 2 * fit_clearance + 6;
    wall = 4;
    difference() {
        union() {
            // Strip mounts to the two x_carriage_plate servo holes.
            translate([-mount_strip_w / 2, -wall, 0]) rounded_box([mount_strip_w, wall, servo_mount_z + 12], 2);
            // Offset cradle keeps the horn clear of the pen guide.
            translate([-cradle_x - 3, -wall, 5]) cube([cradle_x + 3, cradle_y, wall]);
            translate([-cradle_x - 3, -wall, 5]) cube([wall, cradle_y, mg90s_body_z + 8]);
            for (side = [-1, 1])
                translate([-cradle_x / 2 - 3 + side * mg90s_ear_span / 2,
                    -wall + cradle_y / 2, 8])
                    cylinder(d = 7, h = wall);
        }
        for (z = [6, 6 + servo_mount_z])
            translate([0, 0, z]) hole_y(m3_clear, wall + 4);
        // Servo body and ear holes.
        translate([-cradle_x - 3 + (cradle_x - mg90s_body_x) / 2,
            -wall + (cradle_y - mg90s_body_y) / 2,
            4])
            cube([mg90s_body_x + 2 * fit_clearance,
                  mg90s_body_y + 2 * fit_clearance,
                  wall + 3]);
        for (x = [-mg90s_ear_span / 2, mg90s_ear_span / 2])
            translate([-cradle_x / 2 - 3 + x, -wall + cradle_y / 2, 6])
                hole_z(mg90s_ear_hole_d, wall + 5);
    }
}

module belt_clamp() {
    size = [28, 16, 7];
    difference() {
        translate([-size[0] / 2, -size[1] / 2, 0]) rounded_box(size, 2);
        for (x = [-belt_clamp_pitch / 2, belt_clamp_pitch / 2])
            translate([x, 0, 0]) hole_z(m3_clear, size[2]);
        // Shallow 2 mm pitch teeth. Print teeth upward.
        for (x = [-6 : gt2_pitch : 6])
            translate([x, -size[1] / 2 - 1, 4.5]) rotate([45, 0, 0])
                cube([1.0, size[1] + 2, 1.1]);
    }
}

module y_motor_mount() {
    // Motor centre is local Y=0. The base extends inward (+Y) so the motor may
    // sit close to the lower edge without the mounting plate hanging off it.
    base = [72, 70, 8]; wall = 8; base_y0 = -10;
    difference() {
        union() {
            translate([-base[0] / 2, base_y0, 0]) rounded_box(base, 5);
            translate([-base[0] / 2, base_y0, 0]) cube([wall, base[1], 58]);
            for (y = [-2, 48])
                hull() {
                    translate([-base[0] / 2 + wall, y - 4, 0]) cube([27, 8, 4]);
                    translate([-base[0] / 2, y - 4, 38]) cube([wall, 8, 4]);
                }
        }
        for (x = [-25, 25], y = [5, 45])
            translate([x, y, 0]) hole_z(m5_clear, base[2]);
        translate([-base[0] / 2, 0, 29]) hole_x(nema17_pilot_d + 0.6, wall + 4);
        for (y = [-nema17_mount_pitch / 2, nema17_mount_pitch / 2],
             z = [29 - nema17_mount_pitch / 2, 29 + nema17_mount_pitch / 2])
            translate([-base[0] / 2, y, z]) hole_x(nema17_mount_hole_d, wall + 4);
    }
}

module y_idler_mount() {
    // Axle centre is local Y=0; the base reaches inward (-Y).
    base = [52, 50, 8]; base_y0 = -50;
    difference() {
        union() {
            translate([-base[0] / 2, base_y0, 0]) rounded_box(base, 4);
            for (side = [-1, 1])
                translate([-8, side * 9 - 4, base[2] - 1]) rounded_box([16, 8, 35], 3);
        }
        for (x = [-18, 18], y = [-38, -12])
            translate([x, y, 0]) hole_z(m5_clear, base[2]);
        translate([0, 0, 25]) hole_y(gt2_idler_axle_d + 0.35, 32);
    }
}

module x_motor_mount() {
    // Motor face is vertical (XZ); two M5 slots attach to the front/bottom profile grooves.
    plate_w = 58; plate_h = 58; plate_t = 8;
    difference() {
        union() {
            rounded_plate_xz(plate_w, plate_h, plate_t, 5);
            translate([-22, -plate_t / 2, 12]) cube([44, 23, 6]);
            translate([-22, 11, 12]) cube([44, 6, 24]);
        }
        translate([0, 0, plate_h / 2]) hole_y(nema17_pilot_d + 0.6, plate_t + 4);
        for (x = [-nema17_mount_pitch / 2, nema17_mount_pitch / 2],
             z = [plate_h / 2 - nema17_mount_pitch / 2,
                  plate_h / 2 + nema17_mount_pitch / 2])
            translate([x, 0, z]) hole_y(nema17_mount_hole_d, plate_t + 4);
        for (x = [-14, 14])
            translate([x, 14, 23]) hole_z(m5_clear, 12);
    }
}

module x_idler_mount() {
    // Fork mounts to a 2020 groove and supports an axle parallel to Y.
    difference() {
        union() {
            translate([-23, -5, 0]) rounded_box([46, 10, 8], 3);
            for (side = [-1, 1])
                translate([side * 9 - 4, -5, 6]) rounded_box([8, 25, 31], 3);
        }
        for (x = [-14, 14]) translate([x, 0, 0]) hole_z(m5_clear, 10);
        translate([0, 8, 25]) hole_y(gt2_idler_axle_d + 0.35, 34);
    }
}

module support_roller() {
    // The bracket moves with the beam. A 625 bearing rolls on the base with
    // minimal preload; its axle is parallel to X.
    mount = [50, 24, 7];
    fork_gap = bearing625_w + 2 * fit_clearance;
    difference() {
        union() {
            translate([-mount[0] / 2, -mount[1] / 2, -mount[2]]) rounded_box(mount, 4);
            for (side = [-1, 1])
                translate([-4,
                    side > 0 ? fork_gap / 2 : -fork_gap / 2 - 4,
                    -support_bearing_center_drop - 8])
                    rounded_box([8, 4, support_bearing_center_drop + 9], 2);
        }
        for (x = [-16, 16]) translate([x, 0, -mount[2]]) hole_z(m5_clear, mount[2] + 2);
        translate([0, 0, -support_bearing_center_drop])
            hole_x(bearing625_id + 0.30, fork_gap + 12);
    }
}

module endstop_bracket() {
    difference() {
        union() {
            translate([-20, -15, 0]) rounded_box([40, 30, 5], 3);
            translate([-20, -4, 4]) rounded_box([40, 8, 23], 2);
        }
        for (x = [-13, 13]) translate([x, -9, 0]) hole_z(m4_clear, 7);
        for (x = [-switch_hole_pitch / 2, switch_hole_pitch / 2])
            translate([x, 0, 17]) hole_y(switch_hole_d + 0.25, 12);
    }
}

module electronics_base() {
    wall = 3;
    outer = [mks_board_x + 16, mks_board_y + 16, 36];
    difference() {
        rounded_box(outer, 6);
        translate([wall, wall, wall])
            rounded_box([outer[0] - 2 * wall, outer[1] - 2 * wall, outer[2]], 4);
        translate([-1, 18, 12]) cube([wall + 2, 22, 14]);
        translate([outer[0] - wall - 1, 15, 11]) cube([wall + 2, 35, 16]);
        for (x = [18 : 14 : outer[0] - 18])
            translate([x, -1, 19]) cube([8, wall + 2, 10]);
    }
    for (x = [(outer[0] - mks_mount_dx) / 2, (outer[0] + mks_mount_dx) / 2],
         y = [(outer[1] - mks_mount_dy) / 2, (outer[1] + mks_mount_dy) / 2])
        translate([x, y, wall])
            difference() {
                cylinder(d = 8, h = 7);
                cylinder(d = m3_insert_d, h = 7);
            }
}

module electronics_lid() {
    outer = [mks_board_x + 16, mks_board_y + 16, 3];
    difference() {
        rounded_box(outer, 6);
        for (x = [16 : 13 : outer[0] - 16], y = [20, 50, 80])
            if (y < outer[1] - 8)
                translate([x, y, -1]) rounded_box([7, 22, 5], 2);
        for (x = [8, outer[0] - 8], y = [8, outer[1] - 8])
            translate([x, y, -1]) cylinder(d = m3_clear, h = 5);
    }
}

module cable_clip() {
    difference() {
        union() {
            translate([-9, -6, 0]) rounded_box([18, 12, 5], 2);
            translate([-6, -6, 4]) cube([12, 4, 12]);
        }
        translate([0, 0, 10]) hole_y(6.5, 16);
        translate([0, 0, 0]) hole_z(m3_clear, 7);
    }
}

module fit_coupon() {
    difference() {
        rounded_box([92, 30, 8], 3);
        for (i = [0 : 5])
            translate([10 + i * 10, 10, 0])
                hole_z(m3_insert_d - 0.25 + i * 0.10, 10);
        // Sliding-fit ladder for the pen guide.
        for (i = [0 : 3])
            translate([68 + i * 6, 21, -1])
                cylinder(d = pen_d + 2 * pen_slide_wall + 2 * (fit_clearance - 0.15 + i * 0.10), h = 10);
    }
}

// Backward-compatible generic aliases; new builds should use axis-specific parts.
module motor_mount() y_motor_mount();
module idler_mount() y_idler_mount();

// ---------- Assembly ----------
module work_reference() {
    if (show_work_envelope) {
        color([0.15, 0.52, 0.78, 0.12])
            translate([work_origin_x, work_origin_y, base_z + 0.4])
                cube([work_travel_x, work_travel_y, 0.5]);
        color([1.0, 1.0, 1.0, 0.88])
            translate([paper_origin_x, paper_origin_y, base_z + 0.9])
                cube([paper_x, paper_y, 0.35]);
    }
}

module dimension_notes() {
    if (show_dimensions) {
        echo(str("X physical travel = ", x_physical_travel, " mm; controlled = ", work_travel_x,
            " mm; reserve = ", x_physical_travel - work_travel_x, " mm"));
        echo(str("Y physical travel = ", y_physical_travel, " mm; controlled = ", work_travel_y,
            " mm; reserve = ", y_physical_travel - work_travel_y, " mm"));
        echo(str("Work origin = X", work_origin_x, " Y", work_origin_y));
        echo(str("Paper origin = X", paper_origin_x, " Y", paper_origin_y));
        echo(str("Steps/mm = ", 200 * 16 / (gt2_pulley_teeth * gt2_pitch)));
    }
}

module fixed_machine_reference() {
    // Base.
    color([0.72, 0.56, 0.34]) rounded_box([base_x, base_y, base_z], 7);
    work_reference();

    // Y rail.
    translate([y_rail_x - mgn12_rail_w / 2, y_rail_y0, base_z])
        mgn12_rail_y_reference(y_rail_length);

    // Y drive motor, pulley, idler and belt loop.
    y_motor_y = y_drive_motor_center_y;
    y_idler_y = y_drive_idler_center_y;
    y_belt_x = y_rail_x - 20;
    y_belt_z = base_z + 14;

    if (show_reference_components) {
        translate([y_rail_x, y_motor_y, base_z + nema17_face / 2])
            rotate([0, 0, 90]) nema17_reference();
        translate([y_belt_x, y_motor_y, y_belt_z]) pulley_reference("x");
        translate([y_belt_x, y_idler_y, y_belt_z]) idler_reference("x");
        color([0.08, 0.08, 0.08]) {
            translate([y_belt_x - 2.5, y_motor_y, y_belt_z - gt2_belt_w / 2])
                cube([1.3, y_idler_y - y_motor_y, gt2_belt_w]);
            translate([y_belt_x + 2.5, y_motor_y, y_belt_z - gt2_belt_w / 2])
                cube([1.3, y_idler_y - y_motor_y, gt2_belt_w]);
        }
    }
}

module moving_gantry(y_group_center, x_block_center_local, pen_lift = 0, explode = 0) {
    plate_z = y_plate_bottom_z + explode;
    beam_z = profile_bottom_z + explode * 1.6;
    carriage_y = y_group_center + profile_size / 2 + mgn12h_assembly_h + x_plate_t / 2 + explode * 0.5;
    pen_x_pos = beam_x0 + x_block_center_local;
    pen_y_pos = y_group_center + pen_forward_offset;

    // Y blocks and plate.
    if (show_reference_components)
        for (cy = [-y_block_spacing / 2, y_block_spacing / 2])
            translate([y_rail_x, y_group_center + cy, base_z + mgn12_rail_h])
                mgn12h_block_y_reference();

    color([0.10, 0.42, 0.50])
        translate([y_rail_x, y_group_center, plate_z]) y_carriage_plate();

    // Matching belt clamp under the Y plate.
    color([0.16, 0.22, 0.27])
        translate([y_rail_x - 20, y_group_center, plate_z - 7]) belt_clamp();

    // Two matching beam saddles and the 2020 beam.
    for (sx = y_saddle_centres_x)
        color([0.12, 0.28, 0.37])
            translate([y_rail_x + sx, y_group_center, plate_z + y_plate_t]) beam_saddle();

    if (show_reference_components) {
        translate([beam_x0, y_group_center - profile_size / 2, beam_z])
            profile_2020_reference(profile_length);
        translate([beam_x0 + x_rail_start, y_group_center + profile_size / 2, profile_center_z - mgn12_rail_w / 2 + explode * 1.6])
            mgn12_rail_x_reference(x_rail_length);
        translate([pen_x_pos, y_group_center + profile_size / 2 + mgn12_rail_h, profile_center_z + explode * 1.6])
            mgn12h_block_x_reference();
    }

    // X motor, idler and belt. These are attached to and move with the gantry.
    x_motor_x = x_drive_motor_center_x;
    x_idler_x = x_drive_idler_center_x;
    x_belt_y = y_group_center + 42;
    if (show_reference_components) {
        translate([x_motor_x, y_group_center + 30, x_belt_z + explode * 1.6]) nema17_reference();
        translate([x_motor_x, x_belt_y, x_belt_z + explode * 1.6]) pulley_reference("y");
        translate([x_idler_x, x_belt_y, x_belt_z + explode * 1.6]) idler_reference("y");
        color([0.08, 0.08, 0.08]) {
            translate([x_motor_x, x_belt_y - 2.5, x_belt_z - 0.7 + explode * 1.6])
                cube([x_idler_x - x_motor_x, 1.3, 1.4]);
            translate([x_motor_x, x_belt_y + 2.5, x_belt_z - 0.7 + explode * 1.6])
                cube([x_idler_x - x_motor_x, 1.3, 1.4]);
        }
    }

    // Printed axis-specific mounts shown in their real mounting context.
    color([0.12, 0.20, 0.27])
        translate([x_motor_x, y_group_center + 26, x_belt_z - 29 + explode * 1.6]) x_motor_mount();
    color([0.12, 0.20, 0.27])
        translate([x_idler_x, y_group_center + 29, x_belt_z - 25 + explode * 1.6]) x_idler_mount();

    // X carriage and matching belt clamp.
    color([0.08, 0.48, 0.55])
        translate([pen_x_pos, carriage_y, x_plate_bottom_z + explode * 2.0]) x_carriage_plate();
    color([0.13, 0.21, 0.27])
        translate([pen_x_pos, x_belt_y, x_belt_z + explode * 2.0])
            rotate([90, 0, 0]) belt_clamp();

    // Pen guide and slider.
    plate_front_y = carriage_y + x_plate_t / 2;
    color([0.08, 0.32, 0.37])
        translate([pen_x_pos, plate_front_y, pen_body_bottom_z + explode * 2.5]) pen_body();
    color([0.22, 0.31, 0.35])
        translate([pen_x_pos, pen_y_pos, pen_body_bottom_z - 12 + pen_lift + explode * 2.5]) pen_slider();
    color([0.12, 0.24, 0.30])
        translate([pen_x_pos, pen_y_pos, pen_body_bottom_z + pen_body_h - 2 + explode * 2.5]) pen_cap();

    // Servo bracket uses the dedicated two-hole plate interface.
    color([0.12, 0.30, 0.42])
        translate([pen_x_pos - 31, plate_front_y, x_plate_bottom_z + 12 + explode * 2.5]) servo_bracket();
    if (show_reference_components)
        translate([pen_x_pos - 50, plate_front_y + 3, x_plate_bottom_z + 25 + explode * 2.5])
            rotate([90, 0, 0]) mg90s_reference();

    // Lift linkage is schematic but shares the real endpoint locations.
    if (show_reference_components)
        color([0.55, 0.55, 0.55])
            hull() {
                translate([pen_x_pos - 42, pen_y_pos - 2, x_plate_bottom_z + 61 + explode * 2.5]) sphere(d = 1.8);
                translate([pen_x_pos, pen_y_pos, pen_body_bottom_z + 39 + pen_lift + explode * 2.5]) sphere(d = 1.8);
            }

    if (show_reference_components)
        pen_reference(base_z + pen_lift, pen_x_pos, pen_y_pos);

    // Right-end support roller fixed to the beam, bearing touching the base.
    support_x = beam_x0 + profile_length - 24;
    color([0.14, 0.25, 0.30])
        translate([support_x, y_group_center, profile_bottom_z + explode * 1.6]) support_roller();
    if (show_reference_components)
        translate([support_x, y_group_center, base_z + bearing625_od / 2 + explode * 1.6])
            bearing625_reference("x");
}

module limit_and_fixed_mounts_reference() {
    // Fixed Y motor/idler printed mounts. Their holes are defined against the base.
    color([0.12, 0.20, 0.27])
        translate([y_rail_x + 36, y_drive_motor_center_y, base_z]) rotate([0, 0, 90]) y_motor_mount();
    color([0.12, 0.20, 0.27])
        translate([y_rail_x - 20, y_drive_idler_center_y, base_z]) y_idler_mount();

    // Endstop brackets are shown as provisional locations. Exact actuator contact
    // must be set after measuring the purchased switch lever.
    color([0.32, 0.35, 0.38]) {
        translate([y_rail_x + 28, y_rail_y0 + 42, base_z]) endstop_bracket();
        translate([beam_x0 + x_rail_start + 18, y_group_center_min + 18, profile_bottom_z + 1])
            rotate([90, 0, 90]) endstop_bracket();
    }
}

module full_machine(state = "center", explode = 0) {
    t = clamp_value(state_fraction(state), 0, 1);
    y_group_center = lerp(y_group_center_min, y_group_center_max, t);
    x_block_center_local = lerp(x_block_center_min, x_block_center_max, t);
    pen_lift = state == "home" ? pen_vertical_travel : 0;

    dimension_notes();
    fixed_machine_reference();
    moving_gantry(y_group_center, x_block_center_local, pen_lift, explode);
    limit_and_fixed_mounts_reference();
}

module motion_envelope_preview() {
    fixed_machine_reference();
    color([0.10, 0.45, 0.62, 0.30])
        moving_gantry(y_group_center_min, x_block_center_min, pen_vertical_travel, 0);
    color([0.12, 0.62, 0.40, 0.55])
        moving_gantry((y_group_center_min + y_group_center_max) / 2,
                      (x_block_center_min + x_block_center_max) / 2, 0, 0);
    color([0.76, 0.30, 0.22, 0.30])
        moving_gantry(y_group_center_max, x_block_center_max, pen_vertical_travel, 0);
}

// ---------- Part dispatcher ----------
if (part == "assembly" || part == "machine") full_machine(assembly_state, 0);
else if (part == "motion_envelope") motion_envelope_preview();
else if (part == "exploded") full_machine("center", 18);
else if (part == "y_carriage_plate" || part == "plate") y_carriage_plate();
else if (part == "beam_saddle") beam_saddle();
else if (part == "x_carriage_plate" || part == "x_carriage") x_carriage_plate();
else if (part == "pen_body") pen_body();
else if (part == "pen_slider") pen_slider();
else if (part == "pen_cap") pen_cap();
else if (part == "servo_bracket") servo_bracket();
else if (part == "y_motor_mount" || part == "motor_mount") y_motor_mount();
else if (part == "y_idler_mount" || part == "idler_mount") y_idler_mount();
else if (part == "x_motor_mount") x_motor_mount();
else if (part == "x_idler_mount") x_idler_mount();
else if (part == "belt_clamp") belt_clamp();
else if (part == "support_roller") support_roller();
else if (part == "endstop") endstop_bracket();
else if (part == "electronics_base") electronics_base();
else if (part == "electronics_lid") electronics_lid();
else if (part == "cable_clip") cable_clip();
else if (part == "fit_coupon") fit_coupon();
else assert(false, str("Unknown part: ", part));
