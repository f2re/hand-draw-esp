/*
ESP32 A4 Pen Plotter — parametric printable parts
SPDX-License-Identifier: GPL-3.0-or-later

This file is a dimensional starting point, not a substitute for measuring the
actual MGN blocks, servo clone, switches and board received from the seller.
Set `part` below, render (F6), and export STL.
*/

$fn = 64;
part = "assembly";
// plate | x_carriage | pen_body | pen_slider | pen_cap | servo_bracket
// motor_mount | idler_mount | belt_clamp | support_roller | endstop
// electronics_base | electronics_lid | cable_clip | fit_coupon | assembly

// ---------- Global fit parameters ----------
clearance = 0.30;              // radial/side clearance for moving PETG parts
m3_clear = 3.35;
m4_clear = 4.45;
m5_clear = 5.45;
insert_m3_d = 4.70;            // tune with fit_coupon for your inserts
insert_m3_depth = 5.0;

// Nominal MGN12H block geometry; measure the purchased parts.
mgn_hole_x = 20;
mgn_hole_y = 20;
mgn_block_w = 27;
mgn_block_l = 45.4;

// Pen / servo parameters
pen_d = 10.2;                  // measured barrel diameter, typically 8–12 mm
pen_slide_d = pen_d + 5.0;
pen_body_outer_d = pen_slide_d + 6.0;
pen_travel = 8.0;
servo_body = [23.0, 12.5, 29.0]; // MG90S nominal; measure clone
servo_ear_span = 32.5;
servo_screw_d = 2.2;

module rounded_box(size=[20,20,10], r=2) {
    hull() for (x=[r,size[0]-r], y=[r,size[1]-r])
        translate([x,y,0]) cylinder(r=r,h=size[2]);
}

module hole_pattern(spacing=[20,20], d=m3_clear, h=20) {
    for (x=[-spacing[0]/2,spacing[0]/2], y=[-spacing[1]/2,spacing[1]/2])
        translate([x,y,-1]) cylinder(d=d,h=h+2);
}

// Two MGN12H blocks on the single Y rail. The 60 mm center spacing suppresses yaw.
module y_dual_carriage_plate() {
    plate=[86,112,8]; centers=[28,88];
    difference() {
        translate([-plate[0]/2,0,0]) rounded_box(plate,4);
        for (cy=centers)
            translate([0,cy,0]) hole_pattern([mgn_hole_x,mgn_hole_y],m3_clear,plate[2]);
        // X-beam bracket / T-nut mounting slots
        for (x=[-28,28], y=[18,98])
            translate([x,y,-1]) cylinder(d=m5_clear,h=plate[2]+2);
        // cable tie windows
        for (x=[-33,33]) translate([x,56,-1]) rounded_box([7,20,plate[2]+2],2);
    }
}

module x_carriage() {
    size=[70,64,10];
    difference() {
        translate([-size[0]/2,-size[1]/2,0]) rounded_box(size,5);
        hole_pattern([mgn_hole_x,mgn_hole_y],m3_clear,size[2]);
        // central pen holder clamp, M4
        for (y=[-22,22]) translate([0,y,-1]) cylinder(d=m4_clear,h=size[2]+2);
        // belt clamp attachment, M3
        for (x=[-27,27], y=[-21,21]) translate([x,y,-1]) cylinder(d=m3_clear,h=size[2]+2);
        // weight relief
        translate([0,0,-1]) cylinder(d=25,h=size[2]+2);
    }
}

module pen_body() {
    h=52;
    difference() {
        union() {
            cylinder(d=pen_body_outer_d,h=h);
            // mounting ears to the X carriage
            for (a=[0,180]) rotate([0,0,a]) translate([pen_body_outer_d/2-1,-9,16]) rounded_box([13,18,18],3);
            // servo cable/lever boss
            translate([-5,pen_body_outer_d/2-1,30]) rounded_box([10,12,12],2);
        }
        translate([0,0,-1]) cylinder(d=pen_slide_d+2*clearance,h=h+2);
        for (a=[0,180]) rotate([0,0,a]) translate([pen_body_outer_d/2+4,0,25]) rotate([0,90,0]) cylinder(d=m4_clear,h=20,center=true);
        // longitudinal anti-rotation slot
        translate([-2,-pen_body_outer_d/2-1,6]) cube([4,6,36]);
        // servo-lift wire passage
        translate([0,pen_body_outer_d/2+4,35]) rotate([90,0,0]) cylinder(d=2.2,h=20,center=true);
    }
}

module pen_slider() {
    h=42;
    difference() {
        union() {
            cylinder(d=pen_slide_d,h=h);
            // anti-rotation key
            translate([-1.6,-pen_slide_d/2-1,8]) cube([3.2,3.5,26]);
            // lift eye
            translate([-4,pen_slide_d/2-1,h-12]) rounded_box([8,8,10],2);
        }
        translate([0,0,-1]) cylinder(d=pen_d+2*clearance,h=h+2);
        // split collet slot
        translate([-0.6,-pen_slide_d/2-2,0]) cube([1.2,pen_slide_d/2+2,h+2]);
        // clamp screw across split
        translate([0,-pen_slide_d/4,13]) rotate([0,90,0]) cylinder(d=m3_clear,h=pen_slide_d+6,center=true);
        translate([pen_slide_d/2-1,-pen_slide_d/4,13]) rotate([0,90,0]) cylinder(d=insert_m3_d,h=insert_m3_depth,center=true);
        // lift wire eye
        translate([0,pen_slide_d/2+3,h-7]) rotate([90,0,0]) cylinder(d=1.8,h=12,center=true);
    }
}

module pen_cap() {
    h=12;
    difference() {
        cylinder(d=pen_body_outer_d+2,h=h);
        translate([0,0,-1]) cylinder(d=pen_body_outer_d+0.35,h=7);
        translate([0,0,5]) cylinder(d=pen_d+4,h=h+2);
        // side locking screw
        translate([0,(pen_body_outer_d+2)/2,5]) rotate([90,0,0]) cylinder(d=m3_clear,h=10,center=true);
    }
}

module servo_bracket() {
    wall=4; base=[48,38,wall];
    difference() {
        union() {
            translate([-base[0]/2,-base[1]/2,0]) rounded_box(base,3);
            translate([-base[0]/2,-base[1]/2,0]) cube([wall,base[1],38]);
        }
        // servo body clearance
        translate([-servo_body[0]/2,-servo_body[1]/2,-1]) cube([servo_body[0]+2*clearance,servo_body[1]+2*clearance,wall+2]);
        // ear screws, nominal 32.5 mm span
        for (x=[-servo_ear_span/2,servo_ear_span/2]) translate([x,0,-1]) cylinder(d=servo_screw_d,h=wall+2);
        // bracket attachment M4
        for (y=[-12,12]) translate([-base[0]/2-1,y,25]) rotate([0,90,0]) cylinder(d=m4_clear,h=wall+2);
    }
}

module motor_mount() {
    base=[64,62,8]; wall=8;
    difference() {
        union() {
            translate([-base[0]/2,-base[1]/2,0]) rounded_box(base,4);
            translate([-base[0]/2,-base[1]/2,0]) cube([wall,base[1],54]);
            // triangular gussets
            for (y=[-base[1]/2+7,base[1]/2-7]) hull(){translate([-base[0]/2+wall, y-3,0]) cube([26,6,4]);translate([-base[0]/2,y-3,32]) cube([wall,6,4]);}
        }
        // base holes
        for (x=[-22,22],y=[-20,20]) translate([x,y,-1]) cylinder(d=m5_clear,h=base[2]+2);
        // NEMA17 face on vertical wall, shaft toward X
        translate([-base[0]/2-1,0,31]) rotate([0,90,0]) cylinder(d=24,h=wall+2);
        for (y=[-15.5,15.5],z=[15.5,46.5])
            translate([-base[0]/2-1,y,z]) rotate([0,90,0]) cylinder(d=m3_clear,h=wall+2);
    }
}

module idler_mount() {
    base=[48,46,8];
    difference() {
        union() {
            translate([-base[0]/2,-base[1]/2,0]) rounded_box(base,4);
            translate([-7,-8,6]) rounded_box([14,16,34],3);
            hull(){translate([-7,-18,6]) cube([14,10,4]);translate([-7,-8,28]) cube([14,4,4]);}
        }
        for (x=[-16,16],y=[-14,14]) translate([x,y,-1]) cylinder(d=m5_clear,h=base[2]+2);
        translate([0,0,27]) rotate([90,0,0]) cylinder(d=m5_clear,h=24,center=true);
    }
}

module belt_clamp() {
    // Two screws plus shallow 2 mm pitch teeth. Print teeth upward.
    size=[28,16,7];
    difference() {
        translate([-size[0]/2,-size[1]/2,0]) rounded_box(size,2);
        for (x=[-9,9]) translate([x,0,-1]) cylinder(d=m3_clear,h=size[2]+2);
        for (x=[-5:2:5]) translate([x,-size[1]/2-1,4.4]) rotate([45,0,0]) cube([1.0,size[1]+2,1.0]);
    }
}

module support_roller() {
    // Vertical adjustment slot; 625ZZ runs on the base with minimal preload.
    difference() {
        union() {
            translate([-24,-20,0]) rounded_box([48,40,8],4);
            translate([-7,-8,6]) rounded_box([14,16,45],3);
        }
        for (x=[-16,16]) translate([x,0,-1]) cylinder(d=m5_clear,h=10);
        hull(){translate([0,0,20]) rotate([90,0,0]) cylinder(d=m5_clear,h=24,center=true);translate([0,0,38]) rotate([90,0,0]) cylinder(d=m5_clear,h=24,center=true);}
    }
}

module endstop_bracket() {
    difference() {
        union(){translate([-18,-14,0]) rounded_box([36,28,5],3);translate([-18,-4,4]) rounded_box([36,8,22],2);}
        for (x=[-12,12]) translate([x,-8,-1]) cylinder(d=m4_clear,h=7);
        // Generic microswitch 9.5 mm screw pitch; change after measurement.
        for (x=[-4.75,4.75]) translate([x,0,16]) rotate([90,0,0]) cylinder(d=2.5,h=12,center=true);
    }
}

module electronics_base() {
    outer=[132,104,34]; wall=3;
    difference() {
        rounded_box(outer,6);
        translate([wall,wall,wall]) rounded_box([outer[0]-2*wall,outer[1]-2*wall,outer[2]],4);
        // cable and DC openings
        translate([-1,18,12]) cube([wall+2,18,12]);
        translate([outer[0]-wall-1,18,12]) cube([wall+2,25,12]);
        for (x=[22:18:112]) translate([x,-1,20]) cube([9,wall+2,8]);
    }
    // Generic PCB standoffs; measure your MKS revision and adjust.
    for (x=[20,112],y=[18,86]) translate([x,y,3]) difference(){cylinder(d=8,h=7);cylinder(d=insert_m3_d,h=7);}
}

module electronics_lid() {
    size=[132,104,3];
    difference() {
        rounded_box(size,6);
        for (x=[18:14:116],y=[22,52,82]) translate([x,y,-1]) rounded_box([7,28,5],2);
        for (x=[8,124],y=[8,96]) translate([x,y,-1]) cylinder(d=m3_clear,h=5);
    }
}

module cable_clip() {
    difference() {
        union(){translate([-9,-6,0]) rounded_box([18,12,5],2);translate([-6,-6,4]) cube([12,4,12]);}
        translate([0,0,10]) rotate([90,0,0]) cylinder(d=6.5,h=16,center=true);
        translate([0,0,-1]) cylinder(d=m3_clear,h=7);
    }
}

module fit_coupon() {
    difference() {
        translate([0,0,0]) rounded_box([70,24,8],3);
        for (i=[0:5]) translate([10+i*10,12,-1]) cylinder(d=insert_m3_d-0.25+i*0.1,h=10);
    }
}

module assembly_preview() {
    color("#2d4054") translate([-60,0,0]) y_dual_carriage_plate();
    color("#156f7c") translate([55,55,0]) x_carriage();
    color("#222222") translate([55,55,10]) pen_body();
    color("#4666a7") translate([88,55,10]) servo_bracket();
    color("#273746") translate([-130,0,0]) motor_mount();
    color("#273746") translate([145,55,0]) idler_mount();
}

if (part=="plate") y_dual_carriage_plate();
else if (part=="x_carriage") x_carriage();
else if (part=="pen_body") pen_body();
else if (part=="pen_slider") pen_slider();
else if (part=="pen_cap") pen_cap();
else if (part=="servo_bracket") servo_bracket();
else if (part=="motor_mount") motor_mount();
else if (part=="idler_mount") idler_mount();
else if (part=="belt_clamp") belt_clamp();
else if (part=="support_roller") support_roller();
else if (part=="endstop") endstop_bracket();
else if (part=="electronics_base") electronics_base();
else if (part=="electronics_lid") electronics_lid();
else if (part=="cable_clip") cable_clip();
else if (part=="fit_coupon") fit_coupon();
else assembly_preview();
